import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const creator = "81000000-0000-4000-8000-000000000001";
const viewer = "81000000-0000-4000-8000-000000000002";
const other = "81000000-0000-4000-8000-000000000003";
const unverified = "81000000-0000-4000-8000-000000000004";
const metadata = {
  title: "Synthetic telemetry fixture",
  description: "No real provider or video",
  format: "reel",
  genres: ["fantasy"],
  regions: [],
  languages: ["english"],
  tags: [],
  ai_disclosed: true,
  rights_attested: true,
  rights_declaration: "I own the rights to this test fixture.",
};
let db: PGlite;
type Session = { sessionKey: string; accountId: string; versionId: string };
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
async function fixture(published = true, duration = 90) {
  const video = randomUUID(),
    version = randomUUID(),
    reservation = randomUUID(),
    asset = randomUUID();
  await db.query("insert into public.videos(id,owner_id,state) values($1,$2,$3)", [
    video,
    creator,
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
  await db.query("update public.videos set latest_version_id=$2,active_version_id=$3 where id=$1", [
    video,
    version,
    published ? version : null,
  ]);
  await db.query(
    "insert into public.upload_reservations(id,owner_id,version_id,idempotency_key,state,operation_state,consumed_seconds) values($1,$2,$3,$4,'consumed','bound',$5)",
    [reservation, creator, version, randomUUID(), duration],
  );
  await db.query(
    "insert into public.private_media_assets(id,reservation_id,provider_uid,state) values($1,$2,$3,'ready')",
    [asset, reservation, asset.replaceAll("-", "")],
  );
  return { video, version, asset };
}
async function open(
  video: Awaited<ReturnType<typeof fixture>>,
  user: string | null = viewer,
  expires = new Date(Date.now() + 90000).toISOString(),
) {
  return role("service_role", null, () =>
    rpc<Session | null>("open_playback_session", [user, video.video, video.version, expires]),
  );
}
async function elapsed(session: Session, seconds: number) {
  await db.query(
    "update public.playback_sessions set opened_at=clock_timestamp()-make_interval(secs=>$2),updated_at=clock_timestamp()-make_interval(secs=>$2) where session_key=$1",
    [session.sessionKey, seconds],
  );
}
async function progress(video: string, session: string, seconds: number, user = viewer) {
  return role("authenticated", user, () =>
    rpc<{ watchedSeconds: number; credited: boolean }>("record_playback_progress", [
      video,
      session,
      seconds,
    ]),
  );
}

describe("issued public playback telemetry sessions and existing completion records", () => {
  beforeEach(async () => {
    db = new PGlite();
    await db.exec(
      `create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;`,
    );
    for (const name of (await readdir(new URL("../supabase/migrations/", import.meta.url)))
      .filter((n) => n.endsWith(".sql"))
      .sort()) {
      await db.exec(
        await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8"),
      );
    }
    await db.exec(await readFile(new URL("../supabase/seed.sql", import.meta.url), "utf8"));
    await db.exec(
      `insert into auth.users(id,email_confirmed_at) values('${creator}',now()),('${viewer}',now()),('${other}',now()),('${unverified}',null);insert into public.user_roles values('${creator}','creator');`,
    );
  }, 30000);
  afterEach(async () => {
    await db?.close();
  });

  it("opens only verified real published ready versions, never private or guest sessions", async () => {
    const video = await fixture();
    expect(await open(video)).toMatchObject({ accountId: viewer, versionId: video.version });
    expect(await open(video, null)).toBeNull();
    expect(await open(video, unverified)).toBeNull();
    expect(await open(await fixture(false), creator)).toBeNull();
    await db.query("update public.private_media_assets set state='processing' where id=$1", [
      video.asset,
    ]);
    expect(await open(video)).toBeNull();
  });
  it("keeps opener and private rows inaccessible to browsers and progress inaccessible to guests", async () => {
    const video = await fixture();
    for (const name of ["anon", "authenticated"])
      await role(name, name === "authenticated" ? viewer : null, async () => {
        await expect(
          rpc("open_playback_session", [
            viewer,
            video.video,
            video.version,
            new Date(Date.now() + 90000).toISOString(),
          ]),
        ).rejects.toMatchObject({ code: "42501" });
        await expect(db.query("select * from public.playback_sessions")).rejects.toMatchObject({
          code: "42501",
        });
        await expect(
          db.query(
            "insert into public.playback_sessions(user_id,video_id,version_id,duration_seconds,expires_at) values($1,$2,$3,90,now()+interval '90 seconds')",
            [viewer, video.video, video.version],
          ),
        ).rejects.toMatchObject({ code: "42501" });
      });
    await role("anon", null, async () => {
      await expect(
        rpc("record_playback_progress", [video.video, randomUUID(), 1]),
      ).rejects.toMatchObject({ code: "42501" });
    });
  });
  it("rejects arbitrary keys, wrong owners, unverified identities and wrong video IDs", async () => {
    const video = await fixture(),
      second = await fixture(),
      session = (await open(video))!;
    for (const [target, key, user] of [
      [video.video, randomUUID(), viewer],
      [video.video, session.sessionKey, other],
      [video.video, session.sessionKey, unverified],
      [second.video, session.sessionKey, viewer],
    ]) {
      await expect(progress(target, key, 1, user)).rejects.toMatchObject({ code: "42501" });
    }
  });
  it("allows a partial report to advance to 90% once and makes equal retries idempotent", async () => {
    const video = await fixture(),
      session = (await open(video))!;
    await elapsed(session, 10);
    expect(await progress(video.video, session.sessionKey, 10)).toEqual({
      watchedSeconds: 10,
      credited: false,
    });
    await elapsed(session, 90);
    expect(await progress(video.video, session.sessionKey, 81)).toEqual({
      watchedSeconds: 81,
      credited: true,
    });
    expect(await progress(video.video, session.sessionKey, 81)).toEqual({
      watchedSeconds: 81,
      credited: true,
    });
    const { rows } = await db.query(
      "select user_id,version_id,watched_seconds,credited from public.watch_completions",
    );
    expect(rows).toEqual([
      { user_id: viewer, version_id: video.version, watched_seconds: 81, credited: true },
    ]);
    await expect(progress(video.video, session.sessionKey, 80)).rejects.toMatchObject({
      code: "22023",
    });
  });
  it("deduplicates credit across separate sessions for one video and UTC day", async () => {
    const video = await fixture();
    for (let i = 0; i < 2; i++) {
      const session = (await open(video))!;
      await elapsed(session, 90);
      expect((await progress(video.video, session.sessionKey, 90)).credited).toBe(i === 0);
    }
    expect(
      (await db.query("select * from public.watch_completions where credited")).rows,
    ).toHaveLength(1);
  });
  it("rejects instant completion, seeks, nonmonotonic and duration overflow", async () => {
    const video = await fixture(),
      session = (await open(video))!;
    for (const seconds of [81, 91, 0, -1, 181])
      await expect(progress(video.video, session.sessionKey, seconds)).rejects.toMatchObject({
        code: "22023",
      });
    expect(await progress(video.video, session.sessionKey, 2)).toMatchObject({ credited: false });
    await expect(progress(video.video, session.sessionKey, 4)).rejects.toMatchObject({
      code: "22023",
    });
  });
  it("accepts delayed reports against one cumulative clock budget without minting retry slack", async () => {
    const video = await fixture(),
      session = (await open(video))!;
    // Ten seconds actually watched, but its report arrives five seconds late.
    await elapsed(session, 15);
    await progress(video.video, session.sessionKey, 10);
    // The next report represents playback at t20 and arrives on time at t20.
    // Only five seconds separate receipts, while ten more seconds were watched.
    await db.query(
      "update public.playback_sessions set opened_at=clock_timestamp()-interval '20 seconds',updated_at=clock_timestamp()-interval '5 seconds' where session_key=$1",
      [session.sessionKey],
    );
    expect(await progress(video.video, session.sessionKey, 20)).toEqual({
      watchedSeconds: 20,
      credited: false,
    });
    expect(await progress(video.video, session.sessionKey, 20)).toEqual({
      watchedSeconds: 20,
      credited: false,
    });
    await expect(progress(video.video, session.sessionKey, 23)).rejects.toMatchObject({
      code: "22023",
    });
    expect((await db.query("select watched_seconds from public.watch_completions")).rows).toEqual([
      { watched_seconds: 20 },
    ]);
  });
  it.each(["hidden", "removed", "suspended", "version", "asset"])(
    "refuses old-session activity after %s change",
    async (change) => {
      const video = await fixture(),
        session = (await open(video))!;
      await elapsed(session, 90);
      if (change === "hidden" || change === "removed")
        await db.query("update public.videos set state=$2 where id=$1", [video.video, change]);
      if (change === "suspended")
        await db.query(
          "insert into public.creator_suspensions(creator_id,reason,decided_by) values($1,'Synthetic suspension',$2)",
          [creator, other],
        );
      if (change === "version") {
        const replacement = randomUUID();
        await db.query(
          "insert into public.video_versions(id,video_id,revision,metadata,state,duration_seconds) values($1,$2,2,$3,'published',90)",
          [replacement, video.video, JSON.stringify(metadata)],
        );
        await db.query(
          "update public.videos set active_version_id=$2,latest_version_id=$2 where id=$1",
          [video.video, replacement],
        );
      }
      if (change === "asset")
        await db.query("update public.private_media_assets set state='deleting' where id=$1", [
          video.asset,
        ]);
      await expect(progress(video.video, session.sessionKey, 81)).rejects.toMatchObject({
        code: "42501",
      });
      expect((await db.query("select * from public.watch_completions")).rows).toHaveLength(0);
    },
  );
  it("rejects expired sessions, invalid expiry windows and unsupported durations", async () => {
    const video = await fixture(),
      session = (await open(video))!;
    await db.query(
      "update public.playback_sessions set opened_at=clock_timestamp()-interval '100 seconds',expires_at=clock_timestamp()-interval '1 second' where session_key=$1",
      [session.sessionKey],
    );
    await expect(progress(video.video, session.sessionKey, 1)).rejects.toMatchObject({
      code: "42501",
    });
    expect(await open(video, viewer, new Date(Date.now() - 1000).toISOString())).toBeNull();
    expect(await open(video, viewer, new Date(Date.now() + 301000).toISOString())).toBeNull();
    expect(await open(await fixture(true, 0))).toBeNull();
  });
  it("limits opens to 30 per owner per UTC day without preventing another owner", async () => {
    const video = await fixture();
    for (let i = 0; i < 30; i++) expect(await open(video)).not.toBeNull();
    expect(await open(video)).toBeNull();
    expect(await open(video, other)).not.toBeNull();
  });
  it("closes the legacy Library arbitrary-session bypass while preserving real-session calls", async () => {
    const video = await fixture(),
      session = (await open(video))!;
    await elapsed(session, 90);
    await role("authenticated", viewer, async () => {
      await expect(
        rpc("record_watch_completion", [video.video, randomUUID(), 90, true]),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        rpc("record_watch_completion", [video.video, session.sessionKey, 90, false]),
      ).rejects.toMatchObject({ code: "22023" });
      await rpc("record_watch_completion", [video.video, session.sessionKey, 90, true]);
    });
    expect(
      (await db.query("select * from public.watch_completions where credited")).rows,
    ).toHaveLength(1);
  });
  it("reuses approved-cutoff cleanup for expired session IDs with bounded privileged access", async () => {
    const video = await fixture(),
      old = (await open(video))!,
      recent = (await open(video))!;
    await db.query(
      "update public.playback_sessions set opened_at=now()-interval '31 days',updated_at=now()-interval '31 days',expires_at=now()-interval '30 days' where session_key=$1",
      [old.sessionKey],
    );
    const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
    await role("authenticated", viewer, async () => {
      await expect(rpc("purge_operational_events", [cutoff])).rejects.toMatchObject({
        code: "42501",
      });
    });
    expect(
      await role("service_role", null, () => rpc("purge_operational_events", [cutoff])),
    ).toEqual({ watch_events: 0, terminal_provider_events: 0, playback_sessions: 1 });
    expect((await db.query("select session_key from public.playback_sessions")).rows).toEqual([
      { session_key: recent.sessionKey },
    ]);
  });
});
