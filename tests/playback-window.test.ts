import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const owner = "80000000-0000-4000-8000-000000000001";
const admin = "80000000-0000-4000-8000-000000000002";
const moderator = "80000000-0000-4000-8000-000000000003";
const other = "80000000-0000-4000-8000-000000000004";
const metadata = {
  title: "Playback window fixture",
  description: "Synthetic local SQL fixture",
  format: "reel",
  genres: ["fantasy"],
  regions: ["korean"],
  languages: ["english"],
  tags: [],
  ai_disclosed: true,
  rights_attested: true,
  rights_declaration: "I own the rights to this test fixture.",
};
let db: PGlite;
async function asRole<T>(name: string, id: string | null, run: () => Promise<T>) {
  await db.exec(`set role ${name};set request.jwt.claim.sub='${id ?? ""}';`);
  try {
    return await run();
  } finally {
    await db.exec("reset role;reset request.jwt.claim.sub;");
  }
}
async function rpc<T = unknown>(name: string, args: unknown[] = []): Promise<T> {
  const { rows } = await db.query<{ result: T }>(
    `select public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) as result`,
    args,
  );
  return rows[0].result;
}
async function fixture(duration = 180, published = true) {
  const video = randomUUID(),
    version = randomUUID(),
    reservation = randomUUID(),
    asset = randomUUID();
  await db.query("insert into public.videos(id,owner_id,state) values($1,$2,$3)", [
    video,
    owner,
    published ? "published" : "draft",
  ]);
  await db.query(
    "insert into public.video_versions(id,video_id,revision,metadata,state,duration_seconds) values($1,$2,1,$3,$4,$5)",
    [
      version,
      video,
      JSON.stringify(metadata),
      published ? "published" : "pending_review",
      duration,
    ],
  );
  await db.query(
    "insert into public.video_languages(version_id,language_slug) values($1,'english')",
    [version],
  );
  await db.query("update public.videos set latest_version_id=$2,active_version_id=$3 where id=$1", [
    video,
    version,
    published ? version : null,
  ]);
  await db.query(
    "insert into public.upload_reservations(id,owner_id,version_id,idempotency_key,state,operation_state,consumed_seconds) values($1,$2,$3,$4,'consumed','bound',$5)",
    [reservation, owner, version, `playback-${randomUUID()}`, duration],
  );
  await db.query(
    "insert into public.private_media_assets(id,reservation_id,provider_uid,state) values($1,$2,$3,'ready')",
    [asset, reservation, asset.replaceAll("-", "")],
  );
  return { video, version, asset };
}
async function entitlement(
  video: string,
  viewer: string | null = null,
  version: string | null = null,
) {
  return asRole("service_role", null, () =>
    rpc<{ provider_uid: string; version_id: string; expires_at: string } | null>(
      "playback_entitlement",
      [video, viewer, version],
    ),
  );
}
async function remaining(
  video: string,
  viewer: string | null = null,
  version: string | null = null,
) {
  return asRole("service_role", null, async () => {
    const { rows } = await db.query<{ seconds: number }>(
      "select extract(epoch from ((public.playback_entitlement($1,$2,$3)->>'expires_at')::timestamptz-now()))::integer as seconds",
      [video, viewer, version],
    );
    return rows[0].seconds;
  });
}

describe("verified-duration playback authorization window", () => {
  beforeEach(async () => {
    db = new PGlite();
    await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
      create table auth.users(id uuid primary key,raw_user_meta_data jsonb);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema public,auth to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;`);
    for (const name of [
      "202610240001_foundation.sql",
      "202610240002_media.sql",
      "202610240003_trust.sql",
      "202610240004_discovery.sql",
      "202610240005_hardening.sql",
      "202610240006_creator_projection.sql",
      "202610240007_processing_queue.sql",
      "202610240008_playback_window.sql",
    ]) {
      await db.exec(
        await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8"),
      );
    }
    await db.exec(await readFile(new URL("../supabase/seed.sql", import.meta.url), "utf8"));
    await db.exec(
      `insert into auth.users(id) values('${owner}'),('${admin}'),('${moderator}'),('${other}');insert into public.user_roles values('${owner}','creator'),('${admin}','admin'),('${moderator}','moderator');`,
    );
  }, 30000);
  afterEach(async () => {
    await db?.close();
  });

  it("permits a complete verified 180-second film plus 60 seconds for startup", async () => {
    const video = await fixture(180);
    expect(await remaining(video.video)).toBe(240);
    expect(await entitlement(video.video)).toMatchObject({
      version_id: video.version,
      provider_uid: video.asset.replaceAll("-", ""),
    });
  });
  it("uses the same verified-duration window for owner and moderator private previews", async () => {
    const video = await fixture(45, false);
    expect(await remaining(video.video, owner, video.version)).toBe(105);
    expect(await remaining(video.video, moderator, video.version)).toBe(105);
    expect(await entitlement(video.video, null, video.version)).toBeNull();
    expect(await entitlement(video.video, other, video.version)).toBeNull();
  });
  it("keeps defensive minimum and maximum windows bounded without duration overflow", async () => {
    const minimum = await fixture(0),
      maximum = await fixture(2147483647);
    expect(await remaining(minimum.video)).toBe(60);
    expect(await remaining(maximum.video)).toBe(300);
  });
  it.each(["hide", "remove"])(
    "preserves %s denial for guests, owners and reviewers",
    async (action) => {
      const video = await fixture();
      await asRole("authenticated", moderator, () =>
        rpc("moderate_video", [video.video, action, "Local playback visibility test"]),
      );
      for (const viewer of [null, owner, moderator])
        expect(await entitlement(video.video, viewer, video.version)).toBeNull();
    },
  );
  it("preserves suspension and exact video/version/provider readiness boundaries", async () => {
    const one = await fixture(),
      two = await fixture(90, false);
    expect(await entitlement(one.video, owner, two.version)).toBeNull();
    expect(await entitlement(one.video, other, two.version)).toBeNull();
    await db.query("update public.private_media_assets set state='processing' where id=$1", [
      one.asset,
    ]);
    expect(await entitlement(one.video)).toBeNull();
    await db.query("update public.private_media_assets set state='ready' where id=$1", [one.asset]);
    await asRole("authenticated", admin, () =>
      rpc("set_creator_suspension", [owner, true, "Local suspension authorization test"]),
    );
    expect(await entitlement(one.video)).toBeNull();
    expect(await entitlement(two.video, moderator, two.version)).toBeNull();
  });
  it("keeps entitlement lookup service-only so browsers cannot supply viewer identities", async () => {
    const video = await fixture();
    for (const role of ["anon", "authenticated"]) {
      await asRole(role, role === "authenticated" ? owner : null, async () => {
        await expect(
          rpc("playback_entitlement", [video.video, moderator, null]),
        ).rejects.toMatchObject({ code: "42501" });
      });
    }
  });
});
