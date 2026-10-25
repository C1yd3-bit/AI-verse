import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const owner = "82000000-0000-4000-8000-000000000001";
const viewer = "82000000-0000-4000-8000-000000000002";
const moderator = "82000000-0000-4000-8000-000000000003";
const metadata = {
  title: "Synthetic full film",
  description: "No actual provider or footage",
  format: "movie",
  genres: ["fantasy"],
  regions: ["korean"],
  languages: ["english"],
  tags: [],
  ai_disclosed: true,
  rights_attested: true,
  rights_declaration: "I own all rights to this synthetic fixture.",
};
let db: PGlite;
async function role<T>(name: string, id: string | null, run: () => Promise<T>) {
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
async function draft(format = "movie") {
  return role("authenticated", owner, () =>
    rpc<{ video_id: string; version_id: string }>("create_video_version", [
      null,
      JSON.stringify({ ...metadata, format }),
    ]),
  );
}
async function reserve(version: string, key = randomUUID()) {
  return role("authenticated", owner, () =>
    rpc<{ reservation_id: string; max_duration_seconds: number }>("reserve_video_upload", [
      version,
      key,
    ]),
  );
}
async function ready(film: Awaited<ReturnType<typeof draft>>, seconds: number, forceHold?: number) {
  const hold = await reserve(film.version_id);
  if (forceHold)
    await db.query("update public.upload_reservations set reserved_seconds=$2 where id=$1", [
      hold.reservation_id,
      forceHold,
    ]);
  const uid = randomUUID().replaceAll("-", "");
  return role("service_role", null, async () => {
    await rpc("begin_upload_grant", [hold.reservation_id]);
    await rpc("bind_video_provider", [hold.reservation_id, uid]);
    return rpc<{ state: string }>("reconcile_video_provider", [
      randomUUID(),
      uid,
      "ready",
      seconds,
      null,
    ]);
  });
}
async function publish(seconds: number) {
  const film = await draft();
  expect(await ready(film, seconds)).toEqual({ state: "pending_review" });
  await role("authenticated", moderator, () =>
    rpc("review_video_version", [film.version_id, true, "Synthetic verification approved"]),
  );
  return film;
}
describe("full-film quota, publication and long playback boundaries", () => {
  beforeEach(async () => {
    db = new PGlite();
    await db.exec(
      `create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;`,
    );
    for (const name of (await readdir(new URL("../supabase/migrations/", import.meta.url)))
      .filter((n) => n.endsWith(".sql"))
      .sort())
      await db.exec(
        await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8"),
      );
    await db.exec(await readFile(new URL("../supabase/seed.sql", import.meta.url), "utf8"));
    await db.exec(
      `insert into auth.users(id,email_confirmed_at) values('${owner}',now()),('${viewer}',now()),('${moderator}',now());insert into public.user_roles values('${owner}','creator'),('${moderator}','moderator');`,
    );
  }, 30000);
  afterEach(async () => {
    await db?.close();
  });
  it("reserves immutable format caps and keeps one lease for an idempotent request", async () => {
    const film = await draft();
    const reel = await draft("reel");
    const key = randomUUID();
    const held = await reserve(film.version_id, key);
    expect(held.max_duration_seconds).toBe(1200);
    expect(await reserve(film.version_id, key)).toEqual(held);
    expect((await reserve(reel.version_id)).max_duration_seconds).toBe(180);
    await expect(reserve(reel.version_id, key)).rejects.toMatchObject({ code: "22023" });
    await expect(
      role("authenticated", viewer, () =>
        rpc("reserve_video_upload", [film.version_id, randomUUID()]),
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });
  it("fits both supplied rounded durations within the unchanged thirty-minute monthly quota", async () => {
    expect(await ready(await draft(), 737)).toEqual({ state: "pending_review" });
    const second = await draft();
    const hold = await reserve(second.version_id);
    expect(hold.max_duration_seconds).toBe(1063);
    const uid = randomUUID().replaceAll("-", "");
    await role("service_role", null, async () => {
      await rpc("begin_upload_grant", [hold.reservation_id]);
      await rpc("bind_video_provider", [hold.reservation_id, uid]);
      expect(
        await rpc("reconcile_video_provider", [randomUUID(), uid, "ready", 930, null]),
      ).toEqual({ state: "pending_review" });
    });
    const third = await reserve((await draft()).version_id);
    expect(third.max_duration_seconds).toBe(133);
    await expect(reserve((await draft()).version_id)).rejects.toMatchObject({ code: "22023" });
  });
  it("denies a movie beyond its remaining quota and independently denies overlong Reels despite a malformed legacy hold", async () => {
    expect(await ready(await draft("reel"), 181, 1200)).toEqual({ state: "failed" });
    const film = await draft();
    expect(await ready(film, 1201)).toEqual({ state: "failed" });
    const rows = await role("anon", null, () => db.query("select * from public.public_catalog"));
    expect(rows.rows).toEqual([]);
  });
  it("expires holds without granting a new idempotent provider lease", async () => {
    const film = await draft();
    const key = randomUUID();
    const hold = await reserve(film.version_id, key);
    await db.query(
      "update public.upload_reservations set expires_at=now()-interval '1 second' where id=$1",
      [hold.reservation_id],
    );
    expect((await reserve(film.version_id, key)).reservation_id).toBe(hold.reservation_id);
    expect(
      await role("service_role", null, () => rpc("begin_upload_grant", [hold.reservation_id])),
    ).toMatchObject({ lease: false });
    expect((await reserve((await draft()).version_id)).max_duration_seconds).toBe(1200);
  });
  it("issues duration-plus-sixty movie windows and records seek-resistant monotonic long activity", async () => {
    const film = await publish(930);
    const ent = await role("service_role", null, () =>
      rpc<{ expires_at: string; duration_seconds: number }>("playback_entitlement", [
        film.video_id,
        viewer,
        null,
      ]),
    );
    expect(ent.duration_seconds).toBe(930);
    const expiry = await db.query<{ seconds: number }>(
      "select extract(epoch from (($1::timestamptz)-now()))::integer as seconds",
      [ent.expires_at],
    );
    expect(expiry.rows[0].seconds).toBe(990);
    const session = await role("service_role", null, () =>
      rpc<{ sessionKey: string }>("open_playback_session", [
        viewer,
        film.video_id,
        film.version_id,
        ent.expires_at,
      ]),
    );
    expect(session.sessionKey).toBeTruthy();
    await expect(
      role("authenticated", viewer, () =>
        rpc("record_playback_progress", [film.video_id, session.sessionKey, 900]),
      ),
    ).rejects.toMatchObject({ code: "22023" });
    await db.query(
      "update public.playback_sessions set opened_at=clock_timestamp()-interval '900 seconds' where session_key=$1",
      [session.sessionKey],
    );
    const report = () =>
      role("authenticated", viewer, () =>
        rpc("record_playback_progress", [film.video_id, session.sessionKey, 900]),
      );
    expect(await report()).toEqual({ watchedSeconds: 900, credited: true });
    expect(await report()).toEqual({ watchedSeconds: 900, credited: true });
    await expect(
      role("authenticated", viewer, () =>
        rpc("record_playback_progress", [film.video_id, session.sessionKey, 899]),
      ),
    ).rejects.toMatchObject({ code: "22023" });
    await expect(
      role("authenticated", owner, () =>
        rpc("record_playback_progress", [film.video_id, session.sessionKey, 900]),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await db.query("update public.videos set state='hidden' where id=$1", [film.video_id]);
    await expect(report()).rejects.toMatchObject({ code: "42501" });
  });
  it("caps a twenty-minute movie at twenty-one minutes and rejects malformed overlong public Reels", async () => {
    const film = await publish(1200);
    const result = await role("service_role", null, () =>
      db.query<{ seconds: number }>(
        "select extract(epoch from ((public.playback_entitlement($1,null,null)->>'expires_at')::timestamptz-now()))::integer as seconds",
        [film.video_id],
      ),
    );
    expect(result.rows[0].seconds).toBe(1260);
    const reel = await draft("reel");
    await db.query(
      "update public.video_versions set state='published',duration_seconds=181 where id=$1",
      [reel.version_id],
    );
    await db.query("update public.videos set state='published',active_version_id=$2 where id=$1", [
      reel.video_id,
      reel.version_id,
    ]);
    expect(
      await role("service_role", null, () =>
        rpc("playback_entitlement", [reel.video_id, null, null]),
      ),
    ).toBeNull();
  });
});
