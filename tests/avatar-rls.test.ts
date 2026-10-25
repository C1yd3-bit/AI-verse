import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const owner = "94000000-0000-4000-8000-000000000001";
const other = "94000000-0000-4000-8000-000000000002";
const unverified = "94000000-0000-4000-8000-000000000003";
let db: PGlite;
let image: string;
async function asUser<T>(user: string, run: () => Promise<T>) {
  await db.exec(`set role authenticated;set request.jwt.claim.sub='${user}';`);
  try {
    return await run();
  } finally {
    await db.exec("reset role;reset request.jwt.claim.sub;");
  }
}
async function getPhoto() {
  return (await db.query<{ image: string | null }>("select public.get_my_avatar() image")).rows[0]
    .image;
}
async function savePhoto(photo: string | null = image) {
  return db.query("select public.set_my_avatar($1)", [photo]);
}
describe("private verified avatar SQL and RLS", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(
      `create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;`,
    );
    const directory = new URL("../supabase/migrations/", import.meta.url);
    for (const name of (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort())
      await db.exec(await readFile(new URL(name, directory), "utf8"));
    image = `data:image/webp;base64,${(
      await sharp({ create: { width: 256, height: 256, channels: 3, background: "purple" } })
        .webp({ quality: 80 })
        .toBuffer()
    ).toString("base64")}`;
    await db.exec(
      `insert into auth.users(id,email_confirmed_at) values('${owner}',now()),('${other}',now()),('${unverified}',null);`,
    );
  }, 30000);
  beforeEach(async () => {
    await db.exec("truncate public.account_avatars;");
  });
  afterAll(async () => {
    await db?.close();
  });

  it("stores only the verified owner photo, isolates readers and leaves public projections unchanged", async () => {
    await asUser(owner, async () => {
      expect(await getPhoto()).toBeNull();
      await savePhoto();
      expect(await getPhoto()).toBe(image);
      expect(
        (await db.query("select user_id,photo_data from public.account_avatars")).rows,
      ).toEqual([{ user_id: owner, photo_data: image }]);
    });
    await asUser(other, async () => {
      expect(await getPhoto()).toBeNull();
      expect((await db.query("select * from public.account_avatars")).rows).toEqual([]);
      await savePhoto();
      expect(await getPhoto()).toBe(image);
    });
    expect(
      (await db.query("select user_id from public.account_avatars order by user_id")).rows,
    ).toEqual([{ user_id: owner }, { user_id: other }]);
    const publicProfileColumns = (
      await db.query<{ column_name: string }>(
        "select column_name from information_schema.columns where table_schema='public' and table_name='profiles'",
      )
    ).rows.map((row) => row.column_name);
    expect(publicProfileColumns).not.toContain("photo_data");
    expect(publicProfileColumns).not.toContain("avatar");
  });
  it("denies anonymous, missing-identity and unverified access to read/write RPCs and direct writes", async () => {
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      await expect(getPhoto()).rejects.toMatchObject({ code: "42501" });
      await expect(savePhoto()).rejects.toMatchObject({ code: "42501" });
      await db.exec("reset role");
    }
    await asUser(owner, async () => {
      await savePhoto();
    });
    await asUser(unverified, async () => {
      await expect(getPhoto()).rejects.toMatchObject({ code: "42501" });
      await expect(savePhoto()).rejects.toMatchObject({ code: "42501" });
      expect((await db.query("select * from public.account_avatars")).rows).toEqual([]);
    });
    await asUser(other, async () => {
      for (const sql of [
        `insert into public.account_avatars(user_id,photo_data) values('${owner}',$1)`,
        `update public.account_avatars set photo_data=$1 where user_id='${owner}'`,
      ])
        await expect(db.query(sql, [image])).rejects.toMatchObject({ code: "42501" });
      await expect(
        db.exec(`delete from public.account_avatars where user_id='${owner}'`),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        db.query("select public.set_my_avatar($1,$2)", [image, owner]),
      ).rejects.toMatchObject({ code: "42883" });
    });
    await asUser(owner, async () => {
      expect(await getPhoto()).toBe(image);
    });
  });
  it("rejects malformed/noncanonical/oversized envelopes atomically, including direct RPC calls", async () => {
    await asUser(owner, async () => {
      await savePhoto();
      for (const invalid of [
        null,
        "",
        "https://example.test/image.webp",
        "data:image/svg+xml;base64,PHN2Zz4=",
        "data:image/webp;base64,YWJj",
        image + "\n",
        image.replace("base64,", "base64, "),
        "data:image/webp;base64," + Buffer.alloc(65537).toString("base64"),
      ]) {
        await expect(savePhoto(invalid)).rejects.toMatchObject({ code: "22023" });
        expect(await getPhoto()).toBe(image);
      }
      // The validation helper is internal, not an exposed data/RPC surface.
      await expect(db.query("select public.valid_avatar_data($1)", [image])).rejects.toMatchObject({
        code: "42501",
      });
    });
  });
  it("pins definer search paths, limits grants and cascades account removal", async () => {
    const functions = (
      await db.query<{ proname: string; prosecdef: boolean; proconfig: string[] }>(
        "select proname,prosecdef,proconfig from pg_proc where proname in ('get_my_avatar','set_my_avatar') order by proname",
      )
    ).rows;
    expect(functions).toHaveLength(2);
    for (const fn of functions) {
      expect(fn.prosecdef).toBe(true);
      expect(fn.proconfig).toEqual(['search_path=""']);
    }
    await asUser(owner, async () => {
      await savePhoto();
    });
    await db.query("delete from auth.users where id=$1", [owner]);
    expect((await db.query("select * from public.account_avatars")).rows).toEqual([]);
  });
});
