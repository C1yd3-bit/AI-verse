import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
let db: PGlite;
const owner = "20000000-0000-0000-0000-000000000001";
const id = (n: number) => `30000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
describe("public database discovery", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(
      `create role anon; create role authenticated; create role service_role; create schema auth; create table auth.users(id uuid primary key,raw_user_meta_data jsonb); create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$; grant usage on schema auth,public to anon,authenticated,service_role; grant execute on function auth.uid() to anon,authenticated,service_role;`,
    );
    for (const name of [
      "202610240001_foundation.sql",
      "202610240002_media.sql",
      "202610240004_discovery.sql",
    ])
      await db.exec(
        await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8"),
      );
    await db.exec(await readFile(new URL("../supabase/seed.sql", import.meta.url), "utf8"));
    await db.exec(`insert into auth.users values('${owner}','{}');`);
    for (let n = 1; n <= 4; n++) {
      const metadata = {
        title: `Film ${n}`,
        description: "Cat cooking spaghetti",
        format: "reel",
        genres: [n === 3 ? "horror" : "romance"],
        regions: [n === 2 ? "japanese" : "korean"],
        languages: ["korean"],
        tags: ["cat"],
        ai_disclosed: true,
        rights_attested: true,
        rights_declaration: "Owned test fixture rights declaration",
      };
      await db.query("insert into public.videos(id,owner_id,state) values($1,$2,$3)", [
        id(n),
        owner,
        n === 4 ? "draft" : "published",
      ]);
      await db.query(
        "insert into public.video_versions(id,video_id,revision,metadata,state,duration_seconds) values($1,$2,1,$3::jsonb,$4,90)",
        [id(n + 10), id(n), JSON.stringify(metadata), n === 4 ? "draft" : "published"],
      );
      await db.query("insert into public.video_languages values($1,'korean')", [id(n + 10)]);
      await db.query(
        "update public.videos set active_version_id=$1,latest_version_id=$1,published_at=now() where id=$2",
        [id(n + 10), id(n)],
      );
    }
    await db.exec("set role anon");
  }, 30000);
  afterAll(async () => {
    await db?.close();
  });
  async function search(
    filters: unknown,
    after: string | null = null,
    revision: string | null = null,
    limit = 20,
  ) {
    const rows = await db.query<{
      page: {
        revision: string;
        exact: { total: number; items: Record<string, unknown>[]; nextId: string | null };
        broader: { items: Record<string, unknown>[] };
      };
    }>("select public.discover_catalog($1::jsonb,$2::uuid,$3,$4) page", [
      JSON.stringify(filters),
      after,
      revision,
      limit,
    ]);
    return rows.rows[0].page;
  }
  it("filters OR within and AND across dimensions; separates broader suggestions", async () => {
    const page = await search({
      regions: ["korean", "japanese"],
      genres: ["romance"],
      formats: ["reel"],
      languages: ["korean"],
      keywords: ["cat", "cooking"],
      maxDurationSeconds: 119,
    });
    expect(page.exact.items.map((row) => row.id)).toEqual([id(1), id(2)]);
    expect(page.broader.items.map((row) => row.id)).toEqual([id(3)]);
    expect(JSON.stringify(page)).not.toMatch(/provider_uid|rights_declaration|reviewed_by/);
  });
  it("supports stable keyset pages and rejects stale revisions and unknown filters", async () => {
    const first = await search({}, null, null, 2);
    expect(first.exact.total).toBe(3);
    expect(first.exact.nextId).toBe(id(2));
    expect(
      (await search({}, first.exact.nextId, first.revision, 2)).exact.items.map((row) => row.id),
    ).toEqual([id(3)]);
    await expect(search({}, id(2), "stale", 2)).rejects.toThrow(/Catalog changed/);
    await expect(search({ genres: ["bogus"] })).rejects.toThrow(/Unknown taxonomy/);
    await expect(search({ owner_id: owner })).rejects.toThrow(/Unknown discovery/);
    await expect(search({ keywords: { unsafe: "shape" } })).rejects.toThrow(/Array filter/);
  });
  it("global removes region constraints and duration/hashtag restrictions stay exact", async () => {
    expect((await search({ regions: ["global"], hashtags: ["cat"] })).exact.total).toBe(3);
    expect((await search({ maxDurationSeconds: 89 })).exact.total).toBe(0);
    expect((await search({ hashtags: ["not-present"] })).broader.items).toEqual([]);
  });
});
