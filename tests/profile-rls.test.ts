import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { privateProfileSchema } from "../src/features/profile/schema";

const owner = "91000000-0000-4000-8000-000000000001";
const other = "91000000-0000-4000-8000-000000000002";
const unverified = "91000000-0000-4000-8000-000000000003";
const id = (n: number) => `92000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
let db: PGlite;
const basics = { fullName: "Private Owner", age: 28, contactNumber: "+1 555 123 4567" };
async function asUser<T>(user: string, run: () => Promise<T>) {
  await db.exec(`set role authenticated;set request.jwt.claim.sub='${user}';`);
  try {
    return await run();
  } finally {
    await db.exec("reset role;reset request.jwt.claim.sub;");
  }
}
async function profile() {
  return (await db.query<{ profile: unknown }>("select public.get_my_profile() profile")).rows[0]
    .profile;
}
async function patch(value: unknown) {
  return db.query("select public.update_my_account_information($1::jsonb)", [
    JSON.stringify(value),
  ]);
}
describe("private profile ownership and aggregate boundaries", () => {
  beforeEach(async () => {
    db = new PGlite();
    await db.exec(
      `create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;`,
    );
    const directory = new URL("../supabase/migrations/", import.meta.url);
    for (const name of (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort())
      await db.exec(await readFile(new URL(name, directory), "utf8"));
    await db.exec(await readFile(new URL("../supabase/seed.sql", import.meta.url), "utf8"));
    await db.exec(
      `insert into auth.users(id,email_confirmed_at) values('${owner}',now()),('${other}',now()),('${unverified}',null);insert into public.user_roles values('${owner}','creator'),('${other}','admin');update public.profiles set display_name='Public Alias' where id='${owner}';`,
    );
    await asUser(owner, async () => {
      await db.query("select public.complete_account_onboarding($1::jsonb)", [
        JSON.stringify({
          ...basics,
          preferences: { status: "skipped", genres: [], regions: [] },
          ethnicity: "Private self-description",
          ethnicityConsent: true,
        }),
      ]);
    });
  }, 30000);
  afterEach(async () => {
    await db?.close();
  });

  it("defaults dark, persists independently per verified owner and denies direct writes", async () => {
    await asUser(owner, async () => {
      expect(privateProfileSchema.parse(await profile()).appearance.theme).toBe("dark");
      await db.query("select public.set_my_appearance($1)", ["light"]);
      expect(privateProfileSchema.parse(await profile()).appearance.theme).toBe("light");
      await expect(
        db.exec("update public.account_settings set theme='dark'"),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(db.query("select public.set_my_appearance($1)", [null])).rejects.toMatchObject({
        code: "22023",
      });
      await expect(
        db.query("select public.set_my_appearance($1)", ["system"]),
      ).rejects.toMatchObject({ code: "22023" });
      expect(privateProfileSchema.parse(await profile()).appearance.theme).toBe("light");
    });
    await asUser(other, async () => {
      expect((await db.query("select * from public.account_settings")).rows).toEqual([]);
      expect(privateProfileSchema.parse(await profile()).appearance.theme).toBe("dark");
      await db.query("select public.set_my_appearance($1)", ["dark"]);
    });
    expect(
      (await db.query("select user_id,theme from public.account_settings order by user_id")).rows,
    ).toEqual([
      { user_id: owner, theme: "light" },
      { user_id: other, theme: "dark" },
    ]);
  });
  it("denies anonymous, missing-identity and unverified callers to every RPC", async () => {
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      for (const sql of [
        "select public.get_my_profile()",
        "select public.set_my_appearance('light')",
        "select public.update_my_account_information('{}')",
      ])
        await expect(db.exec(sql)).rejects.toMatchObject({ code: "42501" });
      await db.exec("reset role");
    }
    await asUser(unverified, async () => {
      await expect(profile()).rejects.toMatchObject({ code: "42501" });
      await expect(patch(basics)).rejects.toMatchObject({ code: "42501" });
      await expect(db.exec("select public.set_my_appearance('light')")).rejects.toMatchObject({
        code: "42501",
      });
      expect((await db.query("select * from public.account_settings")).rows).toEqual([]);
    });
  });
  it("patches only existing private basics, preserving consent/completion/interests/public identity/roles", async () => {
    const before = (
      await db.query(
        "select ethnicity,ethnicity_consent,ethnicity_consented_at,completed_at from public.account_details where user_id=$1",
        [owner],
      )
    ).rows[0];
    await asUser(owner, async () => {
      await patch({ ...basics, fullName: "Changed Private Name", age: 29, contactNumber: null });
      const snapshot = privateProfileSchema.parse(await profile());
      expect(snapshot.account).toMatchObject({
        fullName: "Changed Private Name",
        age: 29,
        contactNumber: null,
      });
      expect(JSON.stringify(snapshot)).not.toMatch(
        /ethnicity|Private self-description|Public Alias/,
      );
      expect(snapshot.creator).toEqual({
        approved: true,
        suspended: false,
        applicationStatus: null,
      });
    });
    expect(
      (
        await db.query(
          "select ethnicity,ethnicity_consent,ethnicity_consented_at,completed_at from public.account_details where user_id=$1",
          [owner],
        )
      ).rows[0],
    ).toEqual(before);
    expect(
      (
        await db.query(
          "select status,genres,regions from public.viewer_preferences where user_id=$1",
          [owner],
        )
      ).rows,
    ).toEqual([{ status: "skipped", genres: [], regions: [] }]);
    expect(
      (await db.query("select display_name from public.profiles where id=$1", [owner])).rows,
    ).toEqual([{ display_name: "Public Alias" }]);
    expect(
      (await db.query("select role from public.user_roles where user_id=$1 order by role", [owner]))
        .rows,
    ).toEqual([{ role: "creator" }, { role: "viewer" }]);
    await asUser(other, async () => {
      expect(privateProfileSchema.parse(await profile()).account).toBeNull();
      await expect(patch(basics)).rejects.toMatchObject({ code: "22023" });
      await expect(
        db.exec(`update public.account_details set full_name='Hijacked' where user_id='${owner}'`),
      ).rejects.toMatchObject({ code: "42501" });
    });
  });
  it("rejects privilege/owner injection and mismatched SQL bounds atomically", async () => {
    await asUser(owner, async () => {
      for (const value of [
        { ...basics, userId: other },
        { ...basics, role: "admin" },
        { ...basics, ethnicity: null },
        { ...basics, age: 0 },
        { ...basics, age: 121 },
        { ...basics, age: 1.5 },
        { ...basics, age: "25" },
        { ...basics, fullName: "😀".repeat(41) },
        { ...basics, fullName: "  " },
        { ...basics, contactNumber: "12" },
        { ...basics, contactNumber: "a valid number?" },
        { ...basics, contactNumber: "1".repeat(16) },
        { ...basics, contactNumber: 3 },
        { fullName: "Name", age: 28 },
        null,
      ])
        await expect(patch(value)).rejects.toMatchObject({ code: "22023" });
      expect(privateProfileSchema.parse(await profile()).account).toMatchObject(basics);
      await patch({ ...basics, fullName: "😀".repeat(40), age: 120, contactNumber: null });
      expect(privateProfileSchema.parse(await profile()).account?.fullName).toBe("😀".repeat(40));
    });
  });
  it("counts retained owner content and recorded engagement without a recent-20 cap or viewer identifiers", async () => {
    for (let n = 1; n <= 25; n++) {
      const state = n === 25 ? "removed" : n === 24 ? "hidden" : n === 23 ? "draft" : "published";
      const revisionState =
        n >= 24 ? "rejected" : n === 23 ? "draft" : n === 22 ? "pending_review" : "published";
      await db.query(
        "insert into public.videos(id,owner_id,state,created_at) values($1,$2,$3,now()+$4*interval '1 second')",
        [id(n), owner, state, n],
      );
      await db.query(
        "insert into public.video_versions(id,video_id,revision,metadata,state,duration_seconds) values($1,$2,1,$3::jsonb,$4,90)",
        [
          id(n + 100),
          id(n),
          JSON.stringify({
            title: `Film ${n}`,
            format: "reel",
            provider_uid: "never-serialize-provider",
            private_notes: "never-serialize-note",
          }),
          revisionState,
        ],
      );
      await db.query(
        "update public.videos set latest_version_id=$1::uuid,active_version_id=case when state='published' then $1::uuid else null end where id=$2",
        [id(n + 100), id(n)],
      );
    }
    await db.query("insert into public.videos(id,owner_id,state) values($1,$2,'draft')", [
      id(50),
      other,
    ]);
    for (const n of [1, 24, 25, 50])
      await db.query(
        "insert into public.video_signals(user_id,video_id,signal) values($1,$2,'like')",
        [other, id(n)],
      );
    await db.query(
      "insert into public.video_signals(user_id,video_id,signal) values($1,$2,'not_interested')",
      [owner, id(1)],
    );
    for (const [n, credited, day] of [
      [1, true, "2026-10-24"],
      [1, true, "2026-10-23"],
      [24, false, "2026-10-24"],
      [25, true, "2026-10-24"],
    ] as const)
      await db.query(
        "insert into public.watch_completions(user_id,session_key,video_id,version_id,watched_seconds,duration_seconds,user_initiated,credited,recorded_day) values($1,gen_random_uuid(),$2,$3,90,90,true,$4,$5)",
        [other, id(n), id(n + 100), credited, day],
      );
    await asUser(owner, async () => {
      // Existing RLS hides other viewers' events; aggregate RPC exposes only counts.
      expect((await db.query("select * from public.watch_completions")).rows).toEqual([]);
      const snapshot = privateProfileSchema.parse(await profile());
      expect(snapshot.stats).toEqual({
        total: 24,
        published: 22,
        pendingReview: 1,
        drafts: 1,
        likes: 2,
        creditedCompletions: 2,
      });
      expect(snapshot.content).toHaveLength(20);
      expect(snapshot.content[0]).toMatchObject({
        id: id(24),
        state: "hidden",
        likes: 1,
        creditedCompletions: 0,
      });
      expect(snapshot.content.map((v) => v.id)).not.toContain(id(1));
      expect(JSON.stringify(snapshot)).not.toMatch(
        /user_id|session_key|provider|private_notes|never-serialize|92000000-0000-4000-8000-000000000050/,
      );
    });
    await asUser(other, async () => {
      const snapshot = privateProfileSchema.parse(await profile());
      expect(snapshot.stats).toMatchObject({ total: 1, likes: 1, creditedCompletions: 0 });
      expect(snapshot.content.map((v) => v.id)).toEqual([id(50)]);
    });
  });
  it("returns only the owner's latest application status, including suspension, without changing access", async () => {
    await db.query(
      "insert into public.creator_applications(user_id,application,status,decision_reason,created_at) values($1,'{}','rejected','Private rejection note',now()-interval '1 day'),($1,'{}','pending',null,now()),($2,'{}','approved','Other private note',now()+interval '1 day')",
      [owner, other],
    );
    await db.query(
      "insert into public.creator_suspensions(creator_id,reason,decided_by) values($1,'Private safety incident',$2)",
      [owner, other],
    );
    await asUser(owner, async () => {
      const snapshot = privateProfileSchema.parse(await profile());
      expect(snapshot.creator).toEqual({
        approved: true,
        suspended: true,
        applicationStatus: "pending",
      });
      expect(JSON.stringify(snapshot)).not.toMatch(
        /Private safety|Private rejection|Other private/,
      );
      await patch(basics);
      await db.exec("select public.set_my_appearance('light')");
      expect(privateProfileSchema.parse(await profile()).creator).toEqual(snapshot.creator);
    });
  });
});
