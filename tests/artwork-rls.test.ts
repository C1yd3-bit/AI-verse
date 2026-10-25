import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
const owner = "a5000000-0000-4000-8000-000000000001";
const other = "a5000000-0000-4000-8000-000000000002";
const mod = "a5000000-0000-4000-8000-000000000003";
const unverified = "a5000000-0000-4000-8000-000000000004";
const admin = "a5000000-0000-4000-8000-000000000005";
const metadata = {
  title: "Test artwork",
  description: "Isolated synthetic local fixture",
  format: "reel",
  genres: ["fantasy"],
  regions: ["korean"],
  languages: ["english"],
  tags: [],
  ai_disclosed: true,
  rights_attested: true,
  rights_declaration: "I hold the rights to this test fixture",
};
let db: PGlite;
let image: string;
async function role<T>(name: string, account: string | null, run: () => Promise<T>) {
  await db.exec(`set role ${name};set request.jwt.claim.sub='${account ?? ""}';`);
  try {
    return await run();
  } finally {
    await db.exec("reset role;reset request.jwt.claim.sub;");
  }
}
async function rpc<T = unknown>(name: string, args: unknown[] = []) {
  return (
    await db.query<{ result: T }>(
      `select public.${name}(${args.map((_, index) => "$" + (index + 1)).join(",")}) result`,
      args,
    )
  ).rows[0].result;
}
const draft = (videoId: string | null = null) =>
  role("authenticated", owner, () =>
    rpc<{ video_id: string; version_id: string }>("create_video_version", [
      videoId,
      JSON.stringify(metadata),
    ]),
  );
const save = (versionId: string, actor = owner, value: string | null = image) =>
  role("service_role", null, () => rpc("set_version_artwork", [actor, versionId, value]));
const read = (versionId: string, actor = owner) =>
  role("authenticated", actor, () => rpc("get_version_artwork", [versionId]));
const publicRead = (versionId: string) =>
  role("anon", null, () => rpc("get_public_version_artwork", [versionId]));
async function ready(versionId: string, suffix = "one") {
  const reservation = await role("authenticated", owner, () =>
    rpc<{ reservation_id: string }>("reserve_video_upload", [
      versionId,
      "artwork-operation-" + suffix,
    ]),
  );
  await role("service_role", null, async () => {
    await rpc("begin_upload_grant", [reservation.reservation_id]);
    await rpc("bind_video_provider", [reservation.reservation_id, "artwork-provider-" + suffix]);
    await rpc("reconcile_video_provider", [
      "artwork-event-" + suffix,
      "artwork-provider-" + suffix,
      "ready",
      90,
      null,
    ]);
  });
}
const publish = (versionId: string) =>
  role("authenticated", mod, () =>
    rpc("review_video_version", [versionId, true, "Rights and thumbnail reviewed"]),
  );
describe("sealed version artwork SQL boundaries", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(
      "create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;",
    );
    const directory = new URL("../supabase/migrations/", import.meta.url);
    for (const name of (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort())
      await db.exec(await readFile(new URL(name, directory), "utf8"));
    await db.exec(await readFile(new URL("../supabase/seed.sql", import.meta.url), "utf8"));
    await db.exec(
      `insert into auth.users(id,email_confirmed_at) values('${owner}',now()),('${other}',now()),('${mod}',now()),('${unverified}',null),('${admin}',now());insert into public.user_roles values('${owner}','creator'),('${other}','creator'),('${mod}','moderator'),('${unverified}','creator'),('${admin}','admin');`,
    );
    image =
      "data:image/webp;base64," +
      (
        await sharp({ create: { width: 160, height: 90, channels: 3, background: "purple" } })
          .webp()
          .toBuffer()
      ).toString("base64");
  }, 30000);
  beforeEach(async () => {
    await db.exec(
      "truncate public.videos,public.video_versions,public.creator_suspensions,public.provider_events restart identity cascade;",
    );
  });
  afterAll(async () => {
    await db?.close();
  });
  // Every fixture lives only in the in-memory database, never local Supabase.
  async function rollback() {
    await db.exec("reset role;reset request.jwt.claim.sub;");
  }
  it("allows normalized server ingress into own current draft and private owner/mod/admin reads only", async () => {
    try {
      const version = await draft();
      await save(version.version_id);
      expect(await read(version.version_id)).toBe(image);
      expect(await read(version.version_id, mod)).toBe(image);
      expect(await read(version.version_id, admin)).toBe(image);
      await expect(read(version.version_id, other)).rejects.toMatchObject({ code: "42501" });
      await expect(read(version.version_id, unverified)).rejects.toMatchObject({ code: "42501" });
      expect(await publicRead(version.version_id)).toBeNull();
      expect(
        await role("authenticated", owner, () =>
          rpc("can_edit_version_artwork", [version.version_id]),
        ),
      ).toBe(true);
      expect(
        await role("authenticated", other, () =>
          rpc("can_edit_version_artwork", [version.version_id]),
        ),
      ).toBe(false);
    } finally {
      await rollback();
    }
  });
  it("seals writes and raw bytes from every ordinary role and anonymous private reads", async () => {
    try {
      const version = await draft();
      await save(version.version_id);
      for (const name of ["anon", "authenticated"])
        await role(name, owner, async () => {
          await expect(
            rpc("set_version_artwork", [owner, version.version_id, image]),
          ).rejects.toMatchObject({ code: "42501" });
          await expect(db.query("select * from public.version_artwork")).rejects.toMatchObject({
            code: "42501",
          });
          await expect(
            db.query("insert into public.version_artwork values($1,$2,now())", [
              version.version_id,
              image,
            ]),
          ).rejects.toMatchObject({ code: "42501" });
          await expect(db.query("delete from public.version_artwork")).rejects.toMatchObject({
            code: "42501",
          });
          await expect(rpc("valid_version_artwork", [image])).rejects.toMatchObject({
            code: "42501",
          });
        });
      await expect(
        role("anon", null, () => rpc("get_version_artwork", [version.version_id])),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        role("authenticated", null, () => rpc("get_version_artwork", [version.version_id])),
      ).rejects.toMatchObject({ code: "42501" });
    } finally {
      await rollback();
    }
  });
  it("rechecks trusted identity role ownership verification suspension and exact latest draft", async () => {
    try {
      const version = await draft();
      for (const actor of [other, mod, admin, unverified])
        await expect(save(version.version_id, actor)).rejects.toMatchObject({ code: "42501" });
      const newer = await draft(version.video_id);
      await expect(save(version.version_id)).rejects.toMatchObject({ code: "22023" });
      await save(newer.version_id);
      await db.query("delete from public.user_roles where user_id=$1 and role='creator'", [owner]);
      await expect(save(newer.version_id)).rejects.toMatchObject({ code: "42501" });
      await db.query("insert into public.user_roles values($1,'creator')", [owner]);
      await db.query(
        "insert into public.creator_suspensions(creator_id,reason,decided_by) values($1,'Synthetic suspension test',$2)",
        [owner, admin],
      );
      await expect(save(newer.version_id)).rejects.toMatchObject({ code: "42501" });
    } finally {
      await rollback();
    }
  });
  it("freezes artwork at upload and publication while new draft artwork never changes old published revision", async () => {
    try {
      const first = await draft();
      await save(first.version_id);
      await ready(first.version_id);
      await expect(save(first.version_id)).rejects.toMatchObject({ code: "22023" });
      await publish(first.version_id);
      expect(await publicRead(first.version_id)).toBe(image);
      expect(
        (
          await role("anon", null, () =>
            db.query("select version_id,has_artwork from public.public_catalog"),
          )
        ).rows,
      ).toEqual([{ version_id: first.version_id, has_artwork: true }]);
      const second = await draft(first.video_id);
      await save(second.version_id);
      expect(await publicRead(second.version_id)).toBeNull();
      expect(await publicRead(first.version_id)).toBe(image);
      await ready(second.version_id, "two");
      await publish(second.version_id);
      expect(await publicRead(first.version_id)).toBeNull();
      expect(await publicRead(second.version_id)).toBe(image);
    } finally {
      await rollback();
    }
  });
  it("denies hidden removed and suspended public artwork without changing private review access", async () => {
    try {
      const version = await draft();
      await save(version.version_id);
      await ready(version.version_id);
      await publish(version.version_id);
      for (const state of ["hidden", "removed"]) {
        await db.query("update public.videos set state=$1 where id=$2", [state, version.video_id]);
        expect(await publicRead(version.version_id)).toBeNull();
        await expect(save(version.version_id)).rejects.toMatchObject({ code: "22023" });
        expect(await read(version.version_id, mod)).toBe(image);
      }
      await db.query("update public.videos set state='published' where id=$1", [version.video_id]);
      await db.query(
        "insert into public.creator_suspensions(creator_id,reason,decided_by) values($1,'Synthetic suspension test',$2)",
        [owner, admin],
      );
      expect(await publicRead(version.version_id)).toBeNull();
    } finally {
      await rollback();
    }
  });
  it("keeps legacy publication without artwork optional and validates bounded envelopes atomically", async () => {
    try {
      const version = await draft();
      for (const value of [
        null,
        "",
        "https://secret.test",
        "data:image/svg+xml;base64,PHN2Zz4=",
        "data:image/webp;base64,YWJj",
        image + "\n",
        "data:image/webp;base64," + Buffer.alloc(262145).toString("base64"),
      ])
        await expect(save(version.version_id, owner, value)).rejects.toMatchObject({
          code: "22023",
        });
      expect(await read(version.version_id)).toBeNull();
      await ready(version.version_id);
      await publish(version.version_id);
      expect(await publicRead(version.version_id)).toBeNull();
      expect(
        (await role("anon", null, () => db.query("select has_artwork from public.public_catalog")))
          .rows,
      ).toEqual([{ has_artwork: false }]);
    } finally {
      await rollback();
    }
  });
  it("pins definer search paths and only exposes the service ingress to service role", async () => {
    try {
      const functions = (
        await db.query<{ proname: string; prosecdef: boolean; proconfig: string[] }>(
          "select proname,prosecdef,proconfig from pg_proc where proname in ('set_version_artwork','can_edit_version_artwork','get_version_artwork','get_public_version_artwork')",
        )
      ).rows;
      expect(functions).toHaveLength(4);
      for (const fn of functions) {
        expect(fn.prosecdef).toBe(true);
        expect(fn.proconfig).toEqual(['search_path=""']);
      }
    } finally {
      await rollback();
    }
  });
});
