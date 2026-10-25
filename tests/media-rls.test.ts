import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";

const alice = "10000000-0000-0000-0000-000000000001";
const bob = "10000000-0000-0000-0000-000000000002";
const admin = "10000000-0000-0000-0000-000000000003";
const moderator = "10000000-0000-0000-0000-000000000004";
const applicant = "10000000-0000-0000-0000-000000000005";
const metadata = {
  title: "A licensed test film",
  description: "Development test only",
  format: "reel",
  genres: ["fantasy"],
  regions: ["korean"],
  languages: ["english"],
  tags: ["test-film"],
  ai_disclosed: true,
  rights_attested: true,
  rights_declaration: "I hold the required rights",
};
let db: PGlite;
async function role<T>(name: string, id: string | null, run: () => Promise<T>): Promise<T> {
  await db.exec(`set role ${name}; set request.jwt.claim.sub = '${id ?? ""}';`);
  try {
    return await run();
  } finally {
    await db.exec("reset role; reset request.jwt.claim.sub;");
  }
}
async function rpc<T = unknown>(name: string, args: unknown[] = []): Promise<T> {
  const placeholders = args.map((_, index) => `$${index + 1}`).join(",");
  const { rows } = await db.query<{ result: T }>(
    `select public.${name}(${placeholders}) as result`,
    args,
  );
  return rows[0].result;
}
async function draft(owner = alice, videoId: string | null = null, title = metadata.title) {
  return role("authenticated", owner, () =>
    rpc<{ video_id: string; version_id: string }>("create_video_version", [
      videoId,
      JSON.stringify({ ...metadata, title }),
    ]),
  );
}
async function reserve(version: string, key = "operation-key-001", owner = alice) {
  return role("authenticated", owner, () =>
    rpc<{
      reservation_id: string;
      state: string;
      provider_uid: string | null;
      operation_state: string;
    }>("reserve_video_upload", [version, key]),
  );
}
async function ready(
  version: string,
  uid = "provider-test-1",
  key = "operation-key-001",
  owner = alice,
) {
  const reservation = await reserve(version, key, owner);
  await role("service_role", null, async () => {
    await rpc("begin_upload_grant", [reservation.reservation_id]);
    await rpc("bind_video_provider", [reservation.reservation_id, uid]);
    await rpc("reconcile_video_provider", [`ready-${uid}`, uid, "ready", 90, null]);
  });
  return reservation;
}
async function publish(version: string) {
  return role("authenticated", moderator, () =>
    rpc("review_video_version", [version, true, "Rights and content reviewed"]),
  );
}

describe("media SQL contracts and trust boundaries (PostgreSQL/PGlite)", () => {
  beforeEach(async () => {
    db = new PGlite();
    await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;
      create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth,public to anon,authenticated,service_role;
      grant execute on function auth.uid() to anon,authenticated,service_role;`);
    for (const file of [
      "../supabase/migrations/202610240001_foundation.sql",
      "../supabase/seed.sql",
      "../supabase/migrations/202610240002_media.sql",
    ]) {
      await db.exec(await readFile(new URL(file, import.meta.url), "utf8"));
    }
    await db.exec(`insert into auth.users(id) values('${alice}'),('${bob}'),('${admin}'),('${moderator}'),('${applicant}');
      insert into public.user_roles values('${alice}','creator'),('${bob}','creator'),('${admin}','admin'),('${moderator}','moderator');`);
  }, 30000);
  afterEach(async () => {
    await db?.close();
  });

  it("audits administrator application decisions and rejects moderator/self grants", async () => {
    const application = {
      display_name: "Test creator",
      handle: "test-creator",
      bio: "A test portfolio",
      portfolio_url: "https://example.com/portfolio",
      rights_attested: true,
    };
    const id = await role("authenticated", applicant, () =>
      rpc<string>("submit_creator_application", [JSON.stringify(application)]),
    );
    await role("authenticated", moderator, async () => {
      expect((await db.query("select * from public.creator_applications")).rows).toHaveLength(0);
      await expect(
        rpc("decide_creator_application", [id, true, "Approved application"]),
      ).rejects.toThrow(/Administrator required/);
      await expect(
        rpc("set_user_role", [applicant, "creator", true, "Grant creator role"]),
      ).rejects.toThrow(/Administrator required/);
    });
    await role("authenticated", admin, () =>
      rpc("decide_creator_application", [id, true, "Approved application"]),
    );
    expect(
      (
        await db.query("select role from public.user_roles where user_id=$1 and role='creator'", [
          applicant,
        ])
      ).rows,
    ).toHaveLength(1);
    expect(
      (await db.query("select * from public.media_audit where action='creator_approved'")).rows,
    ).toHaveLength(1);
    await role("authenticated", applicant, async () => {
      await expect(
        db.exec("update public.creator_applications set status='approved'"),
      ).rejects.toThrow(/permission denied/);
    });
  });

  it("keeps drafts private, rejects metadata injection and browser provider assertions", async () => {
    const video = await draft();
    await role("authenticated", bob, async () => {
      expect((await db.query("select * from public.video_versions")).rows).toHaveLength(0);
      await expect(
        rpc("create_video_version", [video.video_id, JSON.stringify(metadata)]),
      ).rejects.toThrow(/Own video required/);
      await expect(
        rpc("reserve_video_upload", [video.version_id, "malicious-key"]),
      ).rejects.toThrow(/Own video required/);
      await expect(db.exec("select * from public.private_media_assets")).rejects.toThrow(
        /permission denied/,
      );
      await expect(
        rpc("reconcile_video_provider", ["forged", "forged", "ready", 90, null]),
      ).rejects.toThrow(/permission denied/);
      await expect(rpc("playback_entitlement", [video.video_id, alice, null])).rejects.toThrow(
        /permission denied/,
      );
    });
    await role("authenticated", alice, async () => {
      await expect(db.exec("update public.video_versions set state='published'")).rejects.toThrow(
        /permission denied/,
      );
      await expect(
        rpc("create_video_version", [null, JSON.stringify({ ...metadata, owner_id: bob })]),
      ).rejects.toThrow(/Invalid metadata fields/);
      await expect(
        rpc("create_video_version", [
          null,
          JSON.stringify({ ...metadata, languages: ["nonexistent"] }),
        ]),
      ).rejects.toThrow(/Unknown language/);
    });
    await expect(db.exec("update public.video_versions set metadata='{}'")).rejects.toThrow(
      /immutable/,
    );
    await role("anon", null, async () => {
      expect((await db.query("select * from public.public_catalog")).rows).toHaveLength(0);
      await expect(db.exec("select * from public.video_versions")).rejects.toThrow(
        /permission denied/,
      );
      await expect(rpc("create_video_version", [null, JSON.stringify(metadata)])).rejects.toThrow(
        /permission denied/,
      );
    });
  });

  it("proves reserve → provider-ready → private review → public allowlist → removal", async () => {
    const video = await draft();
    await role("authenticated", moderator, () =>
      expect(
        rpc("review_video_version", [video.version_id, true, "Premature review denied"]),
      ).rejects.toThrow(/Current pending/),
    );
    await ready(video.version_id);
    await role("service_role", null, async () => {
      expect(await rpc("playback_entitlement", [video.video_id, null, null])).toBeNull();
      expect(await rpc("playback_entitlement", [video.video_id, bob, null])).toBeNull();
      expect(
        await rpc("playback_entitlement", [video.video_id, alice, video.version_id]),
      ).toMatchObject({ provider_uid: "provider-test-1", version_id: video.version_id });
      expect(
        await rpc("playback_entitlement", [video.video_id, moderator, video.version_id]),
      ).toMatchObject({ version_id: video.version_id });
    });
    await publish(video.version_id);
    await role("anon", null, async () => {
      const { rows } = await db.query("select * from public.public_catalog");
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: video.video_id,
        title: metadata.title,
        languages: ["english"],
      });
      for (const key of ["provider_uid", "metadata", "rights_declaration", "reason", "reviewed_by"])
        expect(rows[0]).not.toHaveProperty(key);
    });
    await role("service_role", null, async () => {
      const playback = await rpc<{ expires_at: string }>("playback_entitlement", [
        video.video_id,
        null,
        null,
      ]);
      expect(new Date(playback.expires_at).getTime() - Date.now()).toBeLessThanOrEqual(61000);
    });
    await role("authenticated", moderator, () =>
      rpc("moderate_video", [video.video_id, "remove", "Confirmed rights takedown"]),
    );
    await role("anon", null, async () => {
      expect((await db.query("select * from public.public_catalog")).rows).toHaveLength(0);
    });
    await role("service_role", null, async () => {
      expect(await rpc("playback_entitlement", [video.video_id, moderator, null])).toBeNull();
      expect(
        await rpc("reconcile_video_provider", ["late-ready", "provider-test-1", "ready", 90, null]),
      ).toMatchObject({ ignored: true });
    });
    expect(
      (await db.query("select state from public.videos where id=$1", [video.video_id])).rows,
    ).toEqual([{ state: "removed" }]);
    expect((await db.query("select * from public.media_deletion_jobs")).rows).toHaveLength(1);
  });

  it("binds approval to immutable latest revision while preserving the approved public version", async () => {
    const first = await draft();
    await ready(first.version_id);
    await publish(first.version_id);
    const second = await draft(alice, first.video_id, "Unreviewed replacement");
    await ready(second.version_id, "provider-test-2", "operation-key-002");
    await role("anon", null, async () => {
      expect((await db.query("select title from public.public_catalog")).rows).toEqual([
        { title: metadata.title },
      ]);
    });
    const third = await draft(alice, first.video_id, "Newest revision");
    await role("authenticated", moderator, () =>
      expect(
        rpc("review_video_version", [second.version_id, true, "Stale approval denied"]),
      ).rejects.toThrow(/Current pending/),
    );
    await ready(third.version_id, "provider-test-3", "operation-key-003");
    await publish(third.version_id);
    await role("anon", null, async () => {
      expect((await db.query("select title from public.public_catalog")).rows).toEqual([
        { title: "Newest revision" },
      ]);
    });
    await role("service_role", null, async () => {
      expect(
        await rpc("playback_entitlement", [first.video_id, null, first.version_id]),
      ).toBeNull();
      expect(
        await rpc("reconcile_video_provider", [
          "late-failure",
          "provider-test-3",
          "failed",
          null,
          null,
        ]),
      ).toMatchObject({ ignored: true });
    });
  });

  it("serializes quota reservations, enforces idempotency and prevents unsafe provider retries", async () => {
    const first = await draft();
    const a = await reserve(first.version_id);
    const retry = await reserve(first.version_id);
    expect(retry.reservation_id).toBe(a.reservation_id);
    const second = await draft();
    await expect(reserve(second.version_id)).rejects.toThrow(/Idempotency key belongs/);
    await reserve(second.version_id, "operation-key-002");
    const third = await draft();
    await reserve(third.version_id, "operation-key-003");
    const fourth = await draft();
    await expect(reserve(fourth.version_id, "operation-key-004")).rejects.toThrow(/quota exceeded/);
    await role("service_role", null, async () => {
      expect(await rpc("begin_upload_grant", [a.reservation_id])).toMatchObject({
        lease: true,
        operation_state: "granting",
      });
      expect(await rpc("begin_upload_grant", [a.reservation_id])).toMatchObject({ lease: false });
      await rpc("mark_upload_grant_failure", [a.reservation_id, false, "Timeout; outcome unknown"]);
      expect(await rpc("begin_upload_grant", [a.reservation_id])).toMatchObject({
        lease: false,
        operation_state: "uncertain",
      });
      expect(
        await rpc("reconcile_video_provider", [
          "recovered-operation",
          "unknown-until-event",
          "ready",
          80,
          a.reservation_id,
        ]),
      ).toMatchObject({ state: "pending_review" });
      await expect(
        rpc("bind_video_provider", [a.reservation_id, "different-provider"]),
      ).rejects.toThrow(/binding conflict/);
    });
    // The locking invariant is explicit in the function and executed under PostgreSQL.
    const { rows } = await db.query<{ definition: string }>(
      "select pg_get_functiondef('public.reserve_video_upload(uuid,text)'::regprocedure) as definition",
    );
    expect(rows[0].definition).toMatch(/profiles where id=auth.uid\(\) for update/);
  });

  it("rejects expired and oversized media, deduplicates events and prevents revival", async () => {
    const expired = await draft();
    const reservation = await reserve(expired.version_id);
    await db.query(
      "update public.upload_reservations set expires_at=now()-interval '1 minute' where id=$1",
      [reservation.reservation_id],
    );
    await role("service_role", null, async () => {
      expect(await rpc("begin_upload_grant", [reservation.reservation_id])).toMatchObject({
        lease: false,
      });
      expect(
        await rpc("reconcile_video_provider", [
          "late-event",
          "expired-provider",
          "ready",
          90,
          reservation.reservation_id,
        ]),
      ).toMatchObject({ ignored: true });
      expect(
        await rpc("reconcile_video_provider", [
          "late-event",
          "expired-provider",
          "ready",
          90,
          reservation.reservation_id,
        ]),
      ).toMatchObject({ duplicate: true });
      await expect(
        rpc("reconcile_video_provider", ["late-event", "different-asset", "ready", 90, null]),
      ).rejects.toThrow(/Event key conflict/);
    });
    const oversized = await draft();
    const hold = await reserve(oversized.version_id, "operation-key-002");
    await role("service_role", null, async () => {
      await rpc("bind_video_provider", [hold.reservation_id, "oversized-provider"]);
      expect(
        await rpc("reconcile_video_provider", [
          "too-long",
          "oversized-provider",
          "ready",
          181,
          null,
        ]),
      ).toMatchObject({ state: "failed" });
      expect(
        await rpc("reconcile_video_provider", [
          "retry-ready",
          "oversized-provider",
          "ready",
          90,
          null,
        ]),
      ).toMatchObject({ ignored: true });
    });
    expect(
      (
        await db.query("select consumed_seconds from public.upload_reservations where id=$1", [
          hold.reservation_id,
        ])
      ).rows,
    ).toEqual([{ consumed_seconds: 180 }]);
    expect((await db.query("select * from public.media_deletion_jobs")).rows).toHaveLength(2);
  });

  it("uses atomic configured monthly allowance independently of daily count", async () => {
    await db.exec(
      `create or replace function public.get_upload_limits(target uuid) returns jsonb language sql stable security definer set search_path='' as $$select '{"daily_uploads":100,"monthly_seconds":180,"max_duration_seconds":180}'::jsonb$$;`,
    );
    const first = await draft();
    await reserve(first.version_id);
    const second = await draft();
    await expect(reserve(second.version_id, "operation-key-002")).rejects.toThrow(/quota exceeded/);
    expect(
      (
        await db.query(
          "select sum(reserved_seconds)::integer as held from public.upload_reservations",
        )
      ).rows,
    ).toEqual([{ held: 180 }]);
    await db.exec("update public.upload_reservations set expires_at=now()-interval '1 second'");
    await role("service_role", null, () => rpc("expire_upload_reservations"));
    expect(await reserve(second.version_id, "operation-key-002")).toMatchObject({
      state: "reserved",
    });
  });

  it("applies suspension hooks to draft creation, grants, public projection and playback", async () => {
    const published = await draft();
    await ready(published.version_id);
    await publish(published.version_id);
    const unpublished = await draft();
    const hold = await reserve(unpublished.version_id, "operation-key-002");
    await db.exec(
      `create or replace function public.creator_is_suspended(target uuid) returns boolean language sql stable security definer set search_path='' as $$select target='${alice}'::uuid$$;`,
    );
    await expect(draft()).rejects.toThrow(/Approved creator required/);
    await role("anon", null, async () => {
      expect((await db.query("select * from public.public_catalog")).rows).toHaveLength(0);
    });
    await role("service_role", null, async () => {
      expect(await rpc("begin_upload_grant", [hold.reservation_id])).toMatchObject({
        lease: false,
      });
      expect(await rpc("playback_entitlement", [published.video_id, null, null])).toBeNull();
    });
  });

  it("never grants browser execution of internal provider or deletion functions", async () => {
    const names = [
      "begin_upload_grant(uuid)",
      "mark_upload_grant_failure(uuid,boolean,text)",
      "bind_video_provider(uuid,text)",
      "reconcile_video_provider(text,text,text,integer,uuid)",
      "expire_upload_reservations()",
      "playback_entitlement(uuid,uuid,uuid)",
      "claim_media_deletions(integer)",
      "finish_media_deletion(uuid,uuid,boolean,text)",
      "queue_media_deletion(uuid)",
      "validate_video_metadata(jsonb)",
    ];
    for (const name of names) {
      const { rows } = await db.query<{ anon: boolean; authenticated: boolean }>(
        "select has_function_privilege('anon',$1,'execute') as anon,has_function_privilege('authenticated',$1,'execute') as authenticated",
        [`public.${name}`],
      );
      expect(rows[0]).toEqual({ anon: false, authenticated: false });
    }
  });

  it("leases deletion jobs, rejects stale workers and retries with backoff", async () => {
    const video = await draft();
    await ready(video.version_id);
    await publish(video.version_id);
    await role("authenticated", moderator, () =>
      rpc("moderate_video", [video.video_id, "hide", "Needs further rights review"]),
    );
    await role("service_role", null, async () => {
      expect(await rpc("playback_entitlement", [video.video_id, alice, null])).toBeNull();
      const jobs = await rpc<{ job_id: string; lease_token: string; attempts: number }[]>(
        "claim_media_deletions",
        [10],
      );
      expect(jobs).toHaveLength(1);
      expect(jobs[0].attempts).toBe(1);
      expect(await rpc("claim_media_deletions", [10])).toEqual([]);
      await expect(
        rpc("finish_media_deletion", [
          jobs[0].job_id,
          "00000000-0000-0000-0000-000000000000",
          true,
          null,
        ]),
      ).rejects.toThrow(/Valid deletion lease/);
      await rpc("finish_media_deletion", [
        jobs[0].job_id,
        jobs[0].lease_token,
        false,
        "Provider temporarily unavailable",
      ]);
      expect(await rpc("claim_media_deletions", [10])).toEqual([]);
    });
    await db.exec(
      "update public.media_deletion_jobs set next_attempt_at=now()-interval '1 second'",
    );
    await role("service_role", null, async () => {
      const jobs = await rpc<{ job_id: string; lease_token: string; attempts: number }[]>(
        "claim_media_deletions",
        [10],
      );
      expect(jobs[0].attempts).toBe(2);
      await rpc("finish_media_deletion", [jobs[0].job_id, jobs[0].lease_token, true, null]);
      expect(await rpc("claim_media_deletions", [10])).toEqual([]);
    });
    expect((await db.query("select state from public.private_media_assets")).rows).toEqual([
      { state: "deleted" },
    ]);
  });

  it("recovers expired deletion leases and exhausts bounded retries", async () => {
    const video = await draft();
    await ready(video.version_id);
    await role("authenticated", moderator, () =>
      rpc("moderate_video", [video.video_id, "remove", "Remove development asset"]),
    );
    const original = await role("service_role", null, () =>
      rpc<{ job_id: string; lease_token: string }[]>("claim_media_deletions", [1]),
    );
    await db.exec(
      "update public.media_deletion_jobs set lease_until=now()-interval '1 second',attempts=9",
    );
    await role("service_role", null, async () => {
      await expect(
        rpc("finish_media_deletion", [original[0].job_id, original[0].lease_token, true, null]),
      ).rejects.toThrow(/Valid deletion lease/);
      const recovered = await rpc<{ job_id: string; lease_token: string; attempts: number }[]>(
        "claim_media_deletions",
        [1],
      );
      expect(recovered[0].attempts).toBe(10);
      expect(recovered[0].lease_token).not.toBe(original[0].lease_token);
      await rpc("finish_media_deletion", [
        recovered[0].job_id,
        recovered[0].lease_token,
        false,
        "Persistent provider error",
      ]);
      expect(await rpc("claim_media_deletions", [1])).toEqual([]);
    });
    expect((await db.query("select state from public.media_deletion_jobs")).rows).toEqual([
      { state: "exhausted" },
    ]);
  });
});
