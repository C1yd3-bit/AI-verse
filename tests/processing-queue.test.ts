import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const owner = "70000000-0000-4000-8000-000000000001";
const admin = "70000000-0000-4000-8000-000000000002";
const moderator = "70000000-0000-4000-8000-000000000003";
const revoked = "70000000-0000-4000-8000-000000000004";
const suspended = "70000000-0000-4000-8000-000000000005";
const metadata = {
  title: "Processing test",
  description: "Synthetic fixture metadata",
  format: "reel",
  genres: ["fantasy"],
  regions: ["korean"],
  languages: ["english"],
  tags: [],
  ai_disclosed: true,
  rights_attested: true,
  rights_declaration: "I own the rights to this test fixture.",
};
type Claimed = { asset_id: string; provider_uid: string };
let db: PGlite;
let legacy: {
  asset: string;
  video: string;
  version: string;
  reservation: string;
  provider: string;
};
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
async function claim(size = 10) {
  return asRole("service_role", null, () => rpc<Claimed[]>("claim_media_processing", [size]));
}
async function fixture(index = 0, creator = owner) {
  const video = randomUUID(),
    version = randomUUID(),
    reservation = randomUUID(),
    asset = randomUUID(),
    provider = randomUUID().replaceAll("-", "");
  await db.query("insert into public.videos(id,owner_id) values($1,$2)", [video, creator]);
  await db.query(
    "insert into public.video_versions(id,video_id,revision,metadata,state) values($1,$2,1,$3,'processing')",
    [version, video, JSON.stringify(metadata)],
  );
  await db.query(
    "insert into public.video_languages(version_id,language_slug) values($1,'english')",
    [version],
  );
  await db.query("update public.videos set latest_version_id=$2 where id=$1", [video, version]);
  await db.query(
    "insert into public.upload_reservations(id,owner_id,version_id,idempotency_key,state,operation_state) values($1,$2,$3,$4,'bound','bound')",
    [reservation, creator, version, `processing-${randomUUID()}`],
  );
  await db.query(
    "insert into public.private_media_assets(id,reservation_id,provider_uid,created_at) values($1,$2,$3,now()-interval '1 hour'+make_interval(secs=>$4))",
    [asset, reservation, provider, index],
  );
  return { video, version, reservation, asset, provider };
}

describe("fair processing leases and terminal deletion state", () => {
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
    ]) {
      await db.exec(
        await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8"),
      );
    }
    await db.exec(await readFile(new URL("../supabase/seed.sql", import.meta.url), "utf8"));
    await db.exec(
      `insert into auth.users(id) values('${owner}'),('${admin}'),('${moderator}'),('${revoked}'),('${suspended}');insert into public.user_roles values('${owner}','creator'),('${admin}','admin'),('${moderator}','moderator'),('${suspended}','creator');`,
    );
    // Reproduce a pre-migration poisoned polling row whose deletion retries ended.
    legacy = await fixture(-1000);
    await db.query(
      "insert into public.media_deletion_jobs(asset_id,state,attempts) values($1,'exhausted',10)",
      [legacy.asset],
    );
    await db.exec(
      await readFile(
        new URL("../supabase/migrations/202610240007_processing_queue.sql", import.meta.url),
        "utf8",
      ),
    );
  }, 30000);
  afterEach(async () => {
    await db?.close();
  });

  it("backfills legacy exhausted deletion assets out of processing without resetting attempts", async () => {
    expect(
      (await db.query("select state from public.private_media_assets where id=$1", [legacy.asset]))
        .rows,
    ).toEqual([{ state: "deleting" }]);
    expect(
      (
        await db.query("select state,attempts from public.media_deletion_jobs where asset_id=$1", [
          legacy.asset,
        ])
      ).rows,
    ).toEqual([{ state: "exhausted", attempts: 10 }]);
    expect(await claim()).toEqual([]);
  });

  it("polls a newer eleventh asset while the first ten remain unready and leased", async () => {
    const assets: Awaited<ReturnType<typeof fixture>>[] = [];
    for (let index = 0; index < 11; index++) assets.push(await fixture(index));
    const first = await claim(10);
    expect(first.map((row) => row.asset_id)).toEqual(assets.slice(0, 10).map((row) => row.asset));
    const second = await claim(10);
    expect(second).toEqual([{ asset_id: assets[10].asset, provider_uid: assets[10].provider }]);
    expect(await claim(10)).toEqual([]);
    const ready = await asRole("service_role", null, () =>
      rpc("reconcile_video_provider", ["eleventh-ready", assets[10].provider, "ready", 90, null]),
    );
    expect(ready).toEqual({ state: "pending_review" });
    expect(
      (
        await db.query("select state from public.private_media_assets where id=$1", [
          assets[10].asset,
        ])
      ).rows,
    ).toEqual([{ state: "ready" }]);
    const leases = (
      await db.query<{ seconds: number }>(
        "select extract(epoch from poll_lease_until-last_polled_at)::integer as seconds from public.private_media_assets where poll_lease_until is not null",
      )
    ).rows;
    expect(leases).toHaveLength(10);
    expect(leases.every((lease) => lease.seconds === 120)).toBe(true);
  });

  it("prefers unpolled rows and recovers an expired lease without duplicate active claims", async () => {
    const first = await fixture(0),
      second = await fixture(1);
    expect(await claim(1)).toEqual([{ asset_id: first.asset, provider_uid: first.provider }]);
    await db.query(
      "update public.private_media_assets set poll_lease_until=now()-interval '1 second' where id=$1",
      [first.asset],
    );
    expect(await claim(1)).toEqual([{ asset_id: second.asset, provider_uid: second.provider }]);
    expect(await claim(1)).toEqual([{ asset_id: first.asset, provider_uid: first.provider }]);
    expect(await claim(1)).toEqual([]);
  });

  it("excludes queued, hidden, expired, stale, terminal, suspended and revoked creator assets", async () => {
    const queued = await fixture(0);
    await rpc("queue_media_deletion", [queued.asset]);
    const hidden = await fixture(1);
    await asRole("authenticated", moderator, () =>
      rpc("moderate_video", [hidden.video, "hide", "Hidden processing test asset"]),
    );
    const expired = await fixture(2);
    await db.query(
      "update public.upload_reservations set expires_at=now()-interval '1 second' where id=$1",
      [expired.reservation],
    );
    const stale = await fixture(3);
    await db.query("update public.videos set latest_version_id=null where id=$1", [stale.video]);
    const terminal = await fixture(4);
    await db.query("update public.private_media_assets set state='ready' where id=$1", [
      terminal.asset,
    ]);
    const stopped = await fixture(5);
    await db.query("update public.video_versions set state='failed' where id=$1", [
      stopped.version,
    ]);
    await fixture(6, revoked);
    await fixture(7, suspended);
    await db.query(
      "insert into public.creator_suspensions(creator_id,reason,decided_by) values($1,'Suspended fixture creator',$2)",
      [suspended, admin],
    );
    // Defense in depth for an old/incorrect row that has a job but the wrong state.
    const poisoned = await fixture(8);
    await db.query("insert into public.media_deletion_jobs(asset_id) values($1)", [poisoned.asset]);
    const available = await fixture(9);
    expect(await claim(50)).toEqual([
      { asset_id: available.asset, provider_uid: available.provider },
    ]);
  });

  it("makes deletion enqueue idempotent while preserving worker leases, attempts and deleted state", async () => {
    const asset = await fixture();
    await rpc("queue_media_deletion", [asset.asset]);
    const lease = randomUUID();
    await db.query(
      "update public.media_deletion_jobs set state='processing',attempts=4,lease_token=$2,lease_until=now()+interval '2 minutes',last_error='retry evidence' where asset_id=$1",
      [asset.asset, lease],
    );
    await rpc("queue_media_deletion", [asset.asset]);
    await rpc("queue_media_deletion", [asset.asset]);
    const jobs = (
      await db.query(
        "select state,attempts,lease_token,last_error from public.media_deletion_jobs where asset_id=$1",
        [asset.asset],
      )
    ).rows;
    expect(jobs).toEqual([
      { state: "processing", attempts: 4, lease_token: lease, last_error: "retry evidence" },
    ]);
    expect(
      (await db.query("select state from public.private_media_assets where id=$1", [asset.asset]))
        .rows,
    ).toEqual([{ state: "deleting" }]);
    await db.query("update public.private_media_assets set state='deleted' where id=$1", [
      asset.asset,
    ]);
    await rpc("queue_media_deletion", [asset.asset]);
    expect(
      (await db.query("select state from public.private_media_assets where id=$1", [asset.asset]))
        .rows,
    ).toEqual([{ state: "deleted" }]);
    expect(await claim()).toEqual([]);
  });

  it("ignores late callbacks for queued or deleted assets and never restores provider readiness", async () => {
    const asset = await fixture();
    await rpc("queue_media_deletion", [asset.asset]);
    const own = (
      await db.query<{ id: string }>(
        "select id from public.media_deletion_jobs where asset_id=$1",
        [asset.asset],
      )
    ).rows[0];
    await asRole("service_role", null, async () => {
      expect(
        await rpc("reconcile_video_provider", ["late-queued", asset.provider, "ready", 90, null]),
      ).toEqual({ ignored: true, reason: "asset_deletion_queued" });
      const jobs = await rpc<{ job_id: string; lease_token: string }[]>(
        "claim_media_deletions",
        [10],
      );
      const job = jobs.find((item) => item.job_id === own.id)!;
      await rpc("finish_media_deletion", [job.job_id, job.lease_token, true, null]);
      expect(
        await rpc("reconcile_video_provider", ["late-deleted", asset.provider, "ready", 90, null]),
      ).toEqual({ ignored: true, reason: "asset_deletion_queued" });
    });
    expect(
      (await db.query("select state from public.private_media_assets where id=$1", [asset.asset]))
        .rows,
    ).toEqual([{ state: "deleted" }]);
    expect(
      (await db.query("select state from public.video_versions where id=$1", [asset.version])).rows,
    ).toEqual([{ state: "processing" }]);
    expect((await db.query("select * from public.public_catalog")).rows).toEqual([]);
  });

  it("keeps processing claims and provider records inaccessible to browser roles", async () => {
    await fixture();
    for (const name of ["anon", "authenticated"]) {
      await asRole(name, name === "authenticated" ? owner : null, async () => {
        await expect(rpc("claim_media_processing", [10])).rejects.toMatchObject({ code: "42501" });
        await expect(
          db.query(
            "select provider_uid,last_polled_at,poll_lease_until from public.private_media_assets",
          ),
        ).rejects.toMatchObject({ code: "42501" });
      });
    }
    expect((await claim()).length).toBe(1);
  });
});
