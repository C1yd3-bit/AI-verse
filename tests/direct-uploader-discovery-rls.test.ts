import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const uploader = "a1000000-0000-4000-8000-000000000001";
const reader = "a1000000-0000-4000-8000-000000000002";
const legacy = "a1000000-0000-4000-8000-000000000003";
const admin = "a1000000-0000-4000-8000-000000000004";
let db: PGlite;
let publishedId: string;

async function asRole<T>(name: "anon" | "authenticated", id: string | null, run: () => Promise<T>) {
  await db.exec(`set role ${name}; set request.jwt.claim.sub='${id ?? ""}';`);
  try {
    return await run();
  } finally {
    await db.exec("reset role; reset request.jwt.claim.sub;");
  }
}
const follow = (target: string, enabled = true) =>
  db.query("select public.set_creator_follow($1,$2)", [target, enabled]);

describe("public discovery for direct uploaders without creator approval", () => {
  beforeEach(async () => {
    db = new PGlite();
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key,raw_user_meta_data jsonb,email_confirmed_at timestamptz);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema public,auth to anon,authenticated,service_role;
      grant execute on function auth.uid() to anon,authenticated,service_role;`);
    const directory = new URL("../supabase/migrations/", import.meta.url);
    for (const name of (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort()) {
      await db.exec(await readFile(new URL(name, directory), "utf8"));
    }
    await db.exec(await readFile(new URL("../supabase/seed.sql", import.meta.url), "utf8"));
    await db.query(
      "insert into auth.users(id,email_confirmed_at) values($1,now()),($2,now()),($3,now()),($4,now())",
      [uploader, reader, legacy, admin],
    );
    await db.query("insert into public.user_roles values($1,'creator'),($2,'admin')", [
      legacy,
      admin,
    ]);
    await db.query(
      "update public.profiles set display_name='Private identity must not leak' where id=$1",
      [uploader],
    );
    await db.query(
      "insert into public.account_details(user_id,full_name,age,contact_number,ethnicity,ethnicity_consent,ethnicity_consented_at) values($1,'Private real name',25,'+15555555555','Private self description',true,now())",
      [uploader],
    );
    await db.query(
      "insert into public.creator_applications(user_id,application,status,decided_by,decided_at) values($1,$2,'approved',$3,now())",
      [
        legacy,
        JSON.stringify({
          display_name: "Approved public name",
          handle: "approved-handle",
          bio: "Reviewed public biography",
          portfolio_url: "https://private.example",
          rights_attested: true,
        }),
        admin,
      ],
    );
    publishedId = randomUUID();
    const versionId = randomUUID();
    const reservationId = randomUUID();
    await db.query(
      "insert into public.videos(id,owner_id,state,published_at) values($1,$2,'published',now())",
      [publishedId, uploader],
    );
    await db.query(
      "insert into public.video_versions(id,video_id,revision,metadata,state,duration_seconds) values($1,$2,1,$3,'published',90)",
      [
        versionId,
        publishedId,
        JSON.stringify({
          title: "Reviewed direct film",
          description: "Fixture only",
          format: "reel",
          genres: ["fantasy"],
          regions: ["korean"],
          languages: ["english"],
          tags: [],
          ai_disclosed: true,
          rights_attested: true,
          rights_declaration: "Rights cleared",
        }),
      ],
    );
    await db.query(
      "update public.videos set latest_version_id=$2,active_version_id=$2 where id=$1",
      [publishedId, versionId],
    );
    await db.query(
      "insert into public.upload_reservations(id,owner_id,version_id,idempotency_key,state,consumed_seconds) values($1,$2,$3,$4,'consumed',90)",
      [reservationId, uploader, versionId, randomUUID()],
    );
    await db.query(
      "insert into public.private_media_assets(reservation_id,provider_uid,state) values($1,$2,'ready')",
      [reservationId, randomUUID()],
    );
  }, 30000);
  afterEach(async () => {
    await db?.close();
  });

  it("exposes only a generic published-owner identity while preserving approved legacy profiles", async () => {
    await asRole("anon", null, async () => {
      const rows = (await db.query("select * from public.public_creators order by id")).rows;
      expect(rows).toEqual([
        { id: uploader, display_name: "AIVerse creator", handle: "", bio: "" },
        {
          id: legacy,
          display_name: "Approved public name",
          handle: "approved-handle",
          bio: "Reviewed public biography",
        },
      ]);
      expect(JSON.stringify(rows)).not.toMatch(/Private|private\.example|15555555555/);
      await expect(db.query("select * from public.account_details")).rejects.toThrow();
    });
    expect(
      (
        await db.query("select role from public.user_roles where user_id=$1 order by role", [
          uploader,
        ])
      ).rows,
    ).toEqual([{ role: "viewer" }]);
    expect(
      (await db.query("select id from public.creator_applications where user_id=$1", [uploader]))
        .rows,
    ).toEqual([]);
  });

  it("allows idempotent follows of published non-role uploaders and isolates follower rows", async () => {
    await asRole("authenticated", reader, async () => {
      await follow(uploader);
      await follow(uploader);
      expect((await db.query("select creator_id from public.creator_follows")).rows).toEqual([
        { creator_id: uploader },
      ]);
      await expect(follow(reader)).rejects.toThrow(/Invalid follow/);
      await expect(follow(admin)).rejects.toThrow(/Published creator required/);
      await expect(
        db.query("insert into public.creator_follows(user_id,creator_id) values($1,$2)", [
          reader,
          legacy,
        ]),
      ).rejects.toThrow();
    });
    await asRole("authenticated", uploader, async () => {
      expect((await db.query("select * from public.creator_follows")).rows).toEqual([]);
    });
    await asRole("anon", null, async () => {
      await expect(follow(uploader)).rejects.toThrow();
    });
  });

  it("removes generic discovery after hiding the last film while allowing unfollow", async () => {
    await asRole("authenticated", reader, () => follow(uploader));
    await db.query("update public.videos set state='hidden' where id=$1", [publishedId]);
    await asRole("anon", null, async () => {
      expect(
        (await db.query("select * from public.public_creators where id=$1", [uploader])).rows,
      ).toEqual([]);
    });
    await asRole("authenticated", reader, async () => {
      await expect(follow(uploader)).rejects.toThrow(/Published creator required/);
      await follow(uploader, false);
      expect((await db.query("select * from public.creator_follows")).rows).toEqual([]);
    });
  });

  it("hides and blocks follows of suspended direct uploaders without granting creator roles", async () => {
    await asRole("authenticated", admin, () =>
      db.query("select public.set_creator_suspension($1,true,'Rights incident under review')", [
        uploader,
      ]),
    );
    await asRole("anon", null, async () => {
      expect(
        (await db.query("select * from public.public_creators where id=$1", [uploader])).rows,
      ).toEqual([]);
    });
    await asRole("authenticated", reader, async () => {
      await expect(follow(uploader)).rejects.toThrow(/Published creator required/);
    });
    expect(
      (
        await db.query("select role from public.user_roles where user_id=$1 order by role", [
          uploader,
        ])
      ).rows,
    ).toEqual([{ role: "viewer" }]);
  });
});
