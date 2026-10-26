import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const owner = "a7000000-0000-4000-8000-000000000001";
const other = "a7000000-0000-4000-8000-000000000002";
const moderator = "a7000000-0000-4000-8000-000000000003";
const admin = "a7000000-0000-4000-8000-000000000004";
const unverified = "a7000000-0000-4000-8000-000000000005";
const metadata = {
  title: "Private Storage fixture",
  description: "In-memory SQL contract verification",
  format: "reel",
  genres: ["fantasy"],
  regions: ["korean"],
  languages: ["english"],
  tags: [],
  ai_disclosed: true,
  rights_attested: true,
  rights_declaration: "I hold the rights to this synthetic fixture",
};
type Hold = {
  reservation_id: string;
  version_id: string;
  bucket: string;
  object_path: string;
  expires_at: string;
  max_duration_seconds: number;
  file_size: number;
};
type CleanupJob = {
  job_id: string;
  lease_token: string;
  bucket: string;
  object_path: string;
  attempts: number;
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
  return (
    await db.query<{ result: T }>(
      `select public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) result`,
      args,
    )
  ).rows[0].result;
}
const draft = (actor = owner, videoId: string | null = null, format = "reel") =>
  role("authenticated", actor, () =>
    rpc<{ video_id: string; version_id: string }>("create_video_version", [
      videoId,
      JSON.stringify({ ...metadata, format }),
    ]),
  );
const reserve = (version: string, bytes = 1000, actor = owner, key = randomUUID()) =>
  role("authenticated", actor, () =>
    rpc<Hold>("reserve_storage_video_upload", [version, key, bytes]),
  );
const insert = (hold: Hold, actor: string | null = owner, patch: object = {}) =>
  role(actor ? "authenticated" : "anon", actor, () =>
    db.query("insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)", [
      hold.bucket,
      hold.object_path,
      JSON.stringify({ size: hold.file_size, mimetype: "video/mp4", ...patch }),
    ]),
  );
const complete = (hold: Hold, bytes = hold.file_size, duration = 90) =>
  role("service_role", null, () =>
    rpc<{ state: string; video_id: string; version_id: string }>("complete_storage_video_upload", [
      hold.reservation_id,
      bytes,
      duration,
    ]),
  );
const entitlement = (video: string, actor: string | null = null, version: string | null = null) =>
  role(actor ? "authenticated" : "anon", actor, () =>
    rpc<{
      bucket: string;
      object_path: string;
      version_id: string;
      duration_seconds: number;
      public_playback: boolean;
      expires_at: string;
    } | null>("storage_playback_entitlement", [video, version]),
  );
const suspend = (enabled = true) =>
  role("authenticated", admin, () =>
    rpc("set_creator_suspension", [owner, enabled, "Synthetic Storage access decision"]),
  );
const publish = (version: string) =>
  role("authenticated", moderator, () =>
    rpc("review_video_version", [version, true, "Synthetic file and rights reviewed"]),
  );
const objectRead = (actor: string | null) =>
  role(actor ? "authenticated" : "anon", actor, () =>
    db.query("select name from storage.objects where bucket_id='aiverse-videos'"),
  );
const cleanup = (batch = 3) =>
  role("service_role", null, () => rpc<CleanupJob[]>("claim_storage_deletions", [batch]));
const acknowledge = (job: CleanupJob, succeeded = true, token = job.lease_token) =>
  role("service_role", null, () =>
    rpc("finish_media_deletion", [
      job.job_id,
      token,
      succeeded,
      succeeded ? null : "Temporary synthetic Storage failure",
    ]),
  );

describe("private Supabase Storage SQL contracts", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(
      "create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;create schema storage;create table storage.buckets(id text primary key,name text,public boolean default false,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,metadata jsonb,unique(bucket_id,name));alter table storage.objects enable row level security;grant usage on schema storage to anon,authenticated,service_role;grant select,insert,update,delete on storage.objects to anon,authenticated,service_role;",
    );
    const directory = new URL("../supabase/migrations/", import.meta.url);
    for (const name of (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort())
      await db.exec(await readFile(new URL(name, directory), "utf8"));
    await db.exec(await readFile(new URL("../supabase/seed.sql", import.meta.url), "utf8"));
    await db.exec(
      `insert into auth.users(id,email_confirmed_at)values('${owner}',now()),('${other}',now()),('${moderator}',now()),('${admin}',now()),('${unverified}',null);insert into public.user_roles values('${moderator}','moderator'),('${admin}','admin');`,
    );
    // The new restrictive policies must protect this bucket even if unrelated
    // application policies are permissive; other buckets retain their behavior.
    await db.exec(
      "create policy other_app_permissive on storage.objects for all to anon,authenticated using(true) with check(true);insert into storage.buckets(id,name)values('unrelated-bucket','unrelated-bucket');",
    );
  }, 30000);
  beforeEach(async () => {
    await db.exec(
      "truncate storage.objects;truncate public.videos,public.creator_suspensions,public.quota_overrides restart identity cascade;",
    );
    await db.query("update auth.users set email_confirmed_at=now() where id=$1", [owner]);
  });
  afterAll(async () => {
    await db?.close();
  });
  it("creates a private MP4-only 50MB bucket and seals the exact owner/version/reservation path", async () => {
    expect(
      (
        await db.query(
          "select public,file_size_limit,allowed_mime_types from storage.buckets where id='aiverse-videos'",
        )
      ).rows,
    ).toEqual([{ public: false, file_size_limit: 50000000, allowed_mime_types: ["video/mp4"] }]);
    const film = await draft();
    const key = randomUUID();
    const held = await reserve(film.version_id, 50000000, owner, key);
    expect(held.object_path).toBe(`${owner}/${film.version_id}/${held.reservation_id}.mp4`);
    expect(held.max_duration_seconds).toBe(180);
    expect(await reserve(film.version_id, 50000000, owner, key)).toEqual(held);
    await expect(reserve(film.version_id, 1000, owner, key)).rejects.toMatchObject({
      code: "22023",
    });
    for (const bytes of [0, -1, 50000001])
      await expect(reserve((await draft()).version_id, bytes)).rejects.toMatchObject({
        code: "22023",
      });
    expect(
      (
        await role("authenticated", owner, () =>
          db.query(
            "select reservation_id,owner_id,version_id,expected_bytes,state from public.storage_media_uploads",
          ),
        )
      ).rows,
    ).toEqual([
      {
        reservation_id: held.reservation_id,
        owner_id: owner,
        version_id: film.version_id,
        expected_bytes: 50000000,
        state: "reserved",
      },
    ]);
    expect(
      (
        await role("authenticated", other, () =>
          db.query("select * from public.storage_media_uploads"),
        )
      ).rows,
    ).toEqual([]);
    await expect(
      role("anon", null, () => db.query("select * from public.storage_media_uploads")),
    ).rejects.toMatchObject({ code: "42501" });
  });
  it("allows exactly the current eligible reserved path and blocks cross-owner, anonymous, stale and expired writes", async () => {
    const film = await draft();
    const held = await reserve(film.version_id);
    await expect(insert(held, other)).rejects.toMatchObject({ code: "42501" });
    await expect(insert(held, null)).rejects.toMatchObject({ code: "42501" });
    await expect(insert({ ...held, object_path: `${owner}/arbitrary.mp4` })).rejects.toMatchObject({
      code: "42501",
    });
    await expect(reserve(film.version_id, 1000, unverified)).rejects.toMatchObject({
      code: "42501",
    });
    await expect(reserve(film.version_id, 1000, other)).rejects.toMatchObject({ code: "42501" });
    await insert(held);
    await expect(insert(held)).rejects.toMatchObject({ code: "23505" });
    const next = await draft(owner, film.video_id);
    const nextHold = await reserve(next.version_id);
    expect(
      await role("authenticated", owner, () =>
        rpc("can_insert_storage_video", [held.bucket, held.object_path]),
      ),
    ).toBe(false);
    await db.query(
      "update public.upload_reservations set expires_at=now()-interval '1 second' where id=$1",
      [nextHold.reservation_id],
    );
    await expect(insert(nextHold)).rejects.toMatchObject({ code: "42501" });
    await expect(complete(nextHold)).rejects.toMatchObject({ code: "22023" });
  });
  it("never permits browser overwrite, delete, path movement or direct Storage ledger mutation", async () => {
    const held = await reserve((await draft()).version_id);
    await insert(held);
    await complete(held);
    expect((await objectRead(owner)).rows).toEqual([]);
    expect((await objectRead(moderator)).rows).toEqual([]);
    expect(
      (
        await role("service_role", null, () =>
          db.query("select name from storage.objects where bucket_id='aiverse-videos'"),
        )
      ).rows,
    ).toEqual([{ name: held.object_path }]);
    expect(
      (
        await role("authenticated", owner, () =>
          db.query(
            "update storage.objects set metadata='{}' where bucket_id='aiverse-videos' returning id",
          ),
        )
      ).rows,
    ).toEqual([]);
    expect(
      (
        await role("authenticated", owner, () =>
          db.query("delete from storage.objects where bucket_id='aiverse-videos' returning id"),
        )
      ).rows,
    ).toEqual([]);
    await role("authenticated", owner, () =>
      db.query(
        "insert into storage.objects(bucket_id,name,metadata)values('unrelated-bucket','unrelated.mp4','{}')",
      ),
    );
    await expect(
      role("authenticated", owner, () =>
        db.query(
          "update storage.objects set bucket_id='aiverse-videos',name=$1 where bucket_id='unrelated-bucket'",
          [held.object_path],
        ),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      role("authenticated", owner, () =>
        db.query("update public.storage_media_uploads set expected_bytes=1"),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    for (const name of ["complete_storage_video_upload", "fail_storage_video_upload"])
      await expect(
        role("authenticated", owner, () =>
          rpc(
            name,
            name.startsWith("complete")
              ? [held.reservation_id, 1000, 90]
              : [held.reservation_id, "invalid_file"],
          ),
        ),
      ).rejects.toMatchObject({ code: "42501" });
  });
  it("authoritatively checks stored MIME/size and parsed duration facts before any review transition", async () => {
    const held = await reserve((await draft()).version_id);
    await expect(complete(held)).rejects.toMatchObject({ code: "22023" });
    await insert(held, owner, { size: 999 });
    await expect(complete(held)).rejects.toMatchObject({ code: "22023" });
    for (const patch of [
      { size: 1000, mimetype: "text/html" },
      { size: "1e3", mimetype: "video/mp4" },
      { size: "bad", mimetype: "video/mp4" },
    ]) {
      await db.query("update storage.objects set metadata=$1 where name=$2", [
        JSON.stringify(patch),
        held.object_path,
      ]);
      await expect(complete(held)).rejects.toMatchObject({ code: "22023" });
    }
    await db.query("update storage.objects set metadata=$1 where name=$2", [
      JSON.stringify({ size: 1000, mimetype: "video/mp4" }),
      held.object_path,
    ]);
    for (const [bytes, seconds] of [
      [999, 90],
      [1000, 0],
      [1000, 181],
    ])
      await expect(complete(held, bytes, seconds)).rejects.toMatchObject({ code: "22023" });
    const result = await complete(held);
    expect(result.state).toBe("pending_review");
    expect(await complete(held)).toEqual(result);
    await expect(complete(held, 1000, 91)).rejects.toMatchObject({ code: "22023" });
    expect(
      (
        await db.query(
          "select consumed_seconds,state from public.upload_reservations where id=$1",
          [held.reservation_id],
        )
      ).rows,
    ).toEqual([{ consumed_seconds: 90, state: "consumed" }]);
    expect(
      (await db.query("select provider_uid,state from public.private_media_assets")).rows,
    ).toEqual([{ provider_uid: `supabase:${held.reservation_id}`, state: "ready" }]);
  });
  it("denies all browser raw reads while Edge entitlement scopes owner/moderator previews and human publication", async () => {
    const film = await draft();
    const held = await reserve(film.version_id);
    await insert(held);
    expect((await objectRead(owner)).rows).toEqual([]);
    expect(await entitlement(film.video_id, owner)).toBeNull();
    await complete(held);
    expect((await objectRead(owner)).rows).toEqual([]);
    expect((await objectRead(moderator)).rows).toEqual([]);
    expect(await entitlement(film.video_id)).toBeNull();
    expect(await entitlement(film.video_id, other)).toBeNull();
    expect(await entitlement(film.video_id, unverified)).toBeNull();
    expect((await entitlement(film.video_id, owner))?.public_playback).toBe(false);
    expect((await entitlement(film.video_id, moderator))?.version_id).toBe(film.version_id);
    expect((await objectRead(other)).rows).toEqual([]);
    expect((await objectRead(null)).rows).toEqual([]);
    await expect(
      role("authenticated", owner, () =>
        rpc("review_video_version", [film.version_id, true, "No self publication"]),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await publish(film.version_id);
    const guest = await entitlement(film.video_id);
    expect(guest?.public_playback).toBe(true);
    expect(guest?.object_path).toBe(held.object_path);
    expect((await objectRead(null)).rows).toEqual([]);
    expect((await objectRead(other)).rows).toEqual([]);
    expect(await entitlement(film.video_id, null, randomUUID())).toBeNull();
    await role("authenticated", moderator, () =>
      rpc("moderate_video", [film.video_id, "hide", "Synthetic takedown decision"]),
    );
    expect(await entitlement(film.video_id)).toBeNull();
    expect(await entitlement(film.video_id, owner)).toBeNull();
    expect((await objectRead(owner)).rows).toEqual([]);
    expect(await role("service_role", null, () => rpc("claim_media_deletions", [10]))).toEqual([]);
  });
  it("rechecks suspension and email verification after reservation and rejects completion after revision", async () => {
    const film = await draft();
    const held = await reserve(film.version_id);
    await insert(held);
    await suspend();
    await expect(complete(held)).rejects.toMatchObject({ code: "42501" });
    await expect(insert({ ...held, object_path: held.object_path + "x" })).rejects.toMatchObject({
      code: "42501",
    });
    await suspend(false);
    await db.query("update auth.users set email_confirmed_at=null where id=$1", [owner]);
    await expect(complete(held)).rejects.toMatchObject({ code: "42501" });
    await db.query("update auth.users set email_confirmed_at=now() where id=$1", [owner]);
    await draft(owner, film.video_id);
    await expect(complete(held)).rejects.toMatchObject({ code: "22023" });
  });
  it("retains quotas, bounded movie playback and conservative failed-attempt accounting", async () => {
    const film = await draft(owner, null, "movie");
    const held = await reserve(film.version_id);
    expect(held.max_duration_seconds).toBe(1200);
    await insert(held);
    await complete(held, 1000, 1200);
    await publish(film.version_id);
    const data = await entitlement(film.video_id);
    expect(data?.duration_seconds).toBe(1200);
    const expiry = await role("anon", null, () =>
      db.query<{ seconds: number }>(
        "select extract(epoch from ((public.storage_playback_entitlement($1,null)->>'expires_at')::timestamptz-now()))::integer seconds",
        [film.video_id],
      ),
    );
    expect(expiry.rows[0].seconds).toBe(1260);
    const second = await reserve((await draft(owner, null, "movie")).version_id);
    expect(second.max_duration_seconds).toBe(600);
    await role("service_role", null, () =>
      rpc("fail_storage_video_upload", [second.reservation_id, "invalid_file"]),
    );
    await role("service_role", null, () =>
      rpc("fail_storage_video_upload", [second.reservation_id, "invalid_file"]),
    );
    await expect(complete(second)).rejects.toMatchObject({ code: "22023" });
    await expect(reserve((await draft()).version_id)).rejects.toMatchObject({ code: "22023" });
    expect(
      (
        await db.query("select state from public.storage_media_uploads where reservation_id=$1", [
          second.reservation_id,
        ])
      ).rows,
    ).toEqual([{ state: "failed" }]);
  });
  it("separates legacy Stream leases/binding/processing from sealed Storage reservations", async () => {
    const held = await reserve((await draft()).version_id);
    expect(
      (
        await role("service_role", null, () =>
          rpc<{ lease: boolean }>("begin_upload_grant", [held.reservation_id]),
        )
      ).lease,
    ).toBe(false);
    await expect(
      role("service_role", null, () =>
        rpc("bind_video_provider", [held.reservation_id, "legacy-stream-id"]),
      ),
    ).rejects.toMatchObject({ code: "22023" });
    await insert(held);
    await complete(held);
    await db.exec("update public.private_media_assets set state='processing';");
    expect(await role("service_role", null, () => rpc("claim_media_processing", [10]))).toEqual([]);
    expect(
      (await db.query("select role from public.user_roles where user_id=$1", [owner])).rows,
    ).toEqual([{ role: "viewer" }]);
  });
  it("bounds service-only cleanup and expires abandoned paths whether or not bytes were uploaded", async () => {
    const first = await reserve((await draft()).version_id);
    const second = await reserve((await draft()).version_id);
    await insert(first);
    await db.exec("update public.upload_reservations set expires_at=now()-interval '1 second';");
    for (const batch of [0, 4])
      await expect(cleanup(batch)).rejects.toMatchObject({ code: "22023" });
    for (const actor of [owner, moderator])
      await expect(
        role("authenticated", actor, () => rpc("claim_storage_deletions", [3])),
      ).rejects.toMatchObject({ code: "42501" });
    await expect(
      role("anon", null, () => rpc("claim_storage_deletions", [3])),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      role("service_role", null, () => rpc("queue_storage_upload_cleanup", [first.reservation_id])),
    ).rejects.toMatchObject({ code: "42501" });
    expect(await cleanup()).toEqual([]);
    expect(
      (await db.query("select state from public.storage_media_uploads order by reservation_id"))
        .rows,
    ).toEqual([{ state: "failed" }, { state: "failed" }]);
    await db.exec(
      "update public.upload_reservations set expires_at=now()-interval '2 hours 6 minutes';",
    );
    const jobs = await cleanup();
    expect(jobs).toHaveLength(2);
    expect(jobs.map((job) => job.object_path).sort()).toEqual(
      [first.object_path, second.object_path].sort(),
    );
    expect(jobs.every((job) => job.bucket === "aiverse-videos" && job.attempts === 1)).toBe(true);
    expect(
      (await db.query("select state from public.storage_media_uploads order by reservation_id"))
        .rows,
    ).toEqual([{ state: "failed" }, { state: "failed" }]);
    expect((await objectRead(owner)).rows).toEqual([]);
    expect(await cleanup()).toEqual([]);
    await expect(acknowledge(jobs[0], true, randomUUID())).rejects.toMatchObject({ code: "42501" });
    for (const job of jobs) {
      await db.query("delete from storage.objects where bucket_id=$1 and name=$2", [
        job.bucket,
        job.object_path,
      ]);
      await acknowledge(job);
    }
    expect(
      (await db.query("select state from public.private_media_assets order by id")).rows,
    ).toEqual([{ state: "deleted" }, { state: "deleted" }]);
    expect(await cleanup()).toEqual([]);
  });
  it("queues invalid files before physical removal and enforces lease retry/backoff/exhaustion", async () => {
    const film = await draft();
    const held = await reserve(film.version_id);
    await insert(held);
    await role("service_role", null, () =>
      rpc("fail_storage_video_upload", [held.reservation_id, "invalid_file"]),
    );
    await role("service_role", null, () =>
      rpc("fail_storage_video_upload", [held.reservation_id, "invalid_file"]),
    );
    expect((await db.query("select state from public.private_media_assets")).rows).toEqual([
      { state: "deleting" },
    ]);
    expect(
      (await db.query("select count(*)::integer count from public.media_deletion_jobs")).rows,
    ).toEqual([{ count: 1 }]);
    expect((await objectRead(owner)).rows).toEqual([]);
    expect(await entitlement(film.video_id, owner)).toBeNull();
    expect(await cleanup()).toEqual([]);
    await db.query(
      "update public.upload_reservations set expires_at=now()-interval '2 hours 6 minutes' where id=$1",
      [held.reservation_id],
    );
    const first = (await cleanup())[0];
    await acknowledge(first, false);
    expect(await cleanup()).toEqual([]);
    await db.exec(
      "update public.media_deletion_jobs set next_attempt_at=now()-interval '1 second';",
    );
    const second = (await cleanup())[0];
    expect(second.attempts).toBe(2);
    expect(second.lease_token).not.toBe(first.lease_token);
    await expect(acknowledge(first)).rejects.toMatchObject({ code: "42501" });
    await db.exec("update public.media_deletion_jobs set lease_until=now()-interval '1 second';");
    const third = (await cleanup())[0];
    expect(third.attempts).toBe(3);
    expect(third.lease_token).not.toBe(second.lease_token);
    await db.exec(
      "update public.media_deletion_jobs set attempts=9,lease_until=now()-interval '1 second';",
    );
    const last = (await cleanup())[0];
    expect(last.attempts).toBe(10);
    await acknowledge(last, false);
    expect((await db.query("select state from public.media_deletion_jobs")).rows).toEqual([
      { state: "exhausted" },
    ]);
    expect(await cleanup()).toEqual([]);
  });
  it("never expires completed eligible media and never claims ready or unrelated provider assets", async () => {
    const film = await draft();
    const held = await reserve(film.version_id);
    await insert(held);
    await complete(held);
    await db.query(
      "update public.upload_reservations set expires_at=now()-interval '1 second' where id=$1",
      [held.reservation_id],
    );
    expect(await cleanup()).toEqual([]);
    expect((await entitlement(film.video_id, owner))?.version_id).toBe(film.version_id);
    // Even an inconsistent operator-created job must not delete a ready asset.
    await db.exec(
      "insert into public.media_deletion_jobs(asset_id) select id from public.private_media_assets;",
    );
    expect(await cleanup()).toEqual([]);
    expect((await objectRead(owner)).rows).toEqual([]);
    expect((await entitlement(film.video_id, owner))?.version_id).toBe(film.version_id);
    const legacy = await draft();
    const legacyHold = await role("authenticated", owner, () =>
      rpc<{ reservation_id: string }>("reserve_video_upload", [legacy.version_id, randomUUID()]),
    );
    await db.query(
      "insert into public.private_media_assets(reservation_id,provider_uid,state)values($1,'legacy-stream-cleanup','deleting')",
      [legacyHold.reservation_id],
    );
    await db.exec(
      "insert into public.media_deletion_jobs(asset_id) select id from public.private_media_assets where provider_uid='legacy-stream-cleanup';",
    );
    expect(await cleanup()).toEqual([]);
    const claimed = await role("service_role", null, () =>
      rpc<{ provider_uid: string }[]>("claim_media_deletions", [10]),
    );
    expect(claimed.map((job) => job.provider_uid)).toEqual(["legacy-stream-cleanup"]);
    await publish(film.version_id);
    await role("authenticated", moderator, () =>
      rpc("moderate_video", [film.video_id, "hide", "Synthetic review takedown"]),
    );
    expect(await cleanup()).toEqual([]);
    expect(await entitlement(film.video_id)).toBeNull();
    await db.query(
      "update public.upload_reservations set expires_at=now()-interval '2 hours 6 minutes' where id=$1",
      [held.reservation_id],
    );
    const hidden = (await cleanup())[0];
    expect(hidden.object_path).toBe(held.object_path);
    expect(await entitlement(film.video_id)).toBeNull();
  });
  it("quarantines at ingress expiry but holds immutable bytes until every two-hour signed PUT capability has expired", async () => {
    const film = await draft();
    const held = await reserve(film.version_id);
    await insert(held);
    await db.query(
      "update public.upload_reservations set expires_at=now()-interval '1 second' where id=$1",
      [held.reservation_id],
    );
    expect(await cleanup()).toEqual([]);
    expect(
      (await db.query("select state from public.video_versions where id=$1", [film.version_id]))
        .rows,
    ).toEqual([{ state: "failed" }]);
    expect(
      (await db.query("select state,attempts,lease_token from public.media_deletion_jobs")).rows,
    ).toEqual([{ state: "pending", attempts: 0, lease_token: null }]);
    expect(
      (
        await role("service_role", null, () =>
          db.query("select name from storage.objects where name=$1", [held.object_path]),
        )
      ).rows,
    ).toEqual([{ name: held.object_path }]);
    expect(await entitlement(film.video_id, owner)).toBeNull();
    expect((await objectRead(owner)).rows).toEqual([]);
    await db.query(
      "update public.upload_reservations set expires_at=now()-interval '2 hours 4 minutes 59 seconds' where id=$1",
      [held.reservation_id],
    );
    expect(await cleanup()).toEqual([]);
    await db.query(
      "update public.upload_reservations set expires_at=now()-interval '2 hours 5 minutes 1 second' where id=$1",
      [held.reservation_id],
    );
    const job = (await cleanup())[0];
    expect(job.object_path).toBe(held.object_path);
    expect(job.attempts).toBe(1);
    await expect(acknowledge(job, true, randomUUID())).rejects.toMatchObject({ code: "42501" });
    await db.exec("update public.media_deletion_jobs set lease_until=now()-interval '1 second';");
    await expect(acknowledge(job)).rejects.toMatchObject({ code: "42501" });
    const renewed = (await cleanup())[0];
    expect(renewed.lease_token).not.toBe(job.lease_token);
    await expect(acknowledge(job)).rejects.toMatchObject({ code: "42501" });
    await db.query("delete from storage.objects where bucket_id=$1 and name=$2", [
      renewed.bucket,
      renewed.object_path,
    ]);
    await acknowledge(renewed);
    expect((await db.query("select state from public.private_media_assets")).rows).toEqual([
      { state: "deleted" },
    ]);
  });
  it("cannot lease or acknowledge failed, rejected or hidden files during the signed upload capability window", async () => {
    const paths: string[] = [];
    for (const state of ["failed", "rejected", "hidden"]) {
      const film = await draft();
      const held = await reserve(film.version_id);
      await insert(held);
      paths.push(held.object_path);
      if (state === "failed")
        await role("service_role", null, () =>
          rpc("fail_storage_video_upload", [held.reservation_id, "invalid_file"]),
        );
      else {
        await complete(held);
        if (state === "rejected")
          await role("authenticated", moderator, () =>
            rpc("review_video_version", [film.version_id, false, "Synthetic rejected file"]),
          );
        else {
          await publish(film.version_id);
          await role("authenticated", moderator, () =>
            rpc("moderate_video", [film.video_id, "hide", "Synthetic hidden file"]),
          );
        }
      }
      expect(await entitlement(film.video_id, owner)).toBeNull();
      expect(await cleanup()).toEqual([]);
      const job = (
        await db.query<{ id: string }>(
          "select j.id from public.media_deletion_jobs j join public.private_media_assets a on a.id=j.asset_id where a.reservation_id=$1",
          [held.reservation_id],
        )
      ).rows[0];
      await expect(
        role("service_role", null, () =>
          rpc("finish_media_deletion", [job.id, randomUUID(), true, null]),
        ),
      ).rejects.toMatchObject({ code: "42501" });
    }
    expect(
      (
        await db.query(
          "select count(*)::integer count from storage.objects where bucket_id='aiverse-videos'",
        )
      ).rows,
    ).toEqual([{ count: 3 }]);
    await db.exec(
      "update public.upload_reservations set expires_at=now()-interval '2 hours 6 minutes';",
    );
    const jobs = await cleanup();
    expect(jobs.map((job) => job.object_path).sort()).toEqual(paths.sort());
    for (const job of jobs) {
      await db.query("delete from storage.objects where bucket_id=$1 and name=$2", [
        job.bucket,
        job.object_path,
      ]);
      await acknowledge(job);
    }
    expect(
      (
        await db.query(
          "select count(*)::integer count from public.private_media_assets where state='deleted'",
        )
      ).rows,
    ).toEqual([{ count: 3 }]);
  });
});
