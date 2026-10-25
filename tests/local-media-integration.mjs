import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

// Destructive cleanup is restricted to exact UUIDs created by this test in the
// isolated local project. Never point this script at a hosted Supabase project.
const config = readFileSync(new URL("../supabase/config.toml", import.meta.url), "utf8");
assert.match(config, /^project_id\s*=\s*"aiverse-ana"\s*$/m, "Expected isolated local project");
function readLocalStatus() {
  try {
    return JSON.parse(
      execFileSync(
        process.platform === "win32" ? "supabase.exe" : "supabase",
        ["status", "-o", "json"],
        {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        },
      ),
    );
  } catch {
    throw new Error("Local Supabase status is unavailable; captured credentials were not logged");
  }
}
const status = readLocalStatus();
assert.equal(status.API_URL, "http://127.0.0.1:55321", "Only the isolated loopback API is allowed");
const base = new URL(process.env.AIVERSE_TEST_APP_URL ?? "http://127.0.0.1:3000");
assert.equal(base.protocol, "http:");
assert.equal(base.hostname, "127.0.0.1");
assert.equal(base.pathname, "/");
assert.equal(base.username + base.password + base.search + base.hash, "");
const options = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
};
const internal = createClient(status.API_URL, status.SERVICE_ROLE_KEY, options);
const guest = createClient(status.API_URL, status.ANON_KEY, options);
const created = [];
const simulatedProviderIds = [];
const password = randomBytes(24).toString("base64url");
const metadata = {
  title: "Local integration film",
  description: "Temporary synthetic metadata for local database tests; no media upload occurs.",
  format: "reel",
  genres: ["fantasy"],
  regions: ["korean"],
  languages: ["english"],
  tags: ["local-test"],
  ai_disclosed: true,
  rights_attested: true,
  rights_declaration: "This is a local test with synthetic metadata and no uploaded media.",
};
function check(result, message) {
  assert.equal(
    result.error?.code ?? null,
    null,
    `${message}${result.error ? ` [${result.error.code ?? "unknown"}]` : ""}`,
  );
  return result.data;
}
async function rpc(client, name, input, message = name) {
  return check(await client.rpc(name, input), message);
}
function browserSession() {
  const jar = new Map();
  return async (path, body, method = body ? "POST" : "GET") => {
    const target = new URL(path, base);
    assert.equal(target.origin, base.origin, "HTTP tests must remain on the loopback application");
    const response = await fetch(target, {
      method,
      redirect: "manual",
      headers: {
        origin: base.origin,
        "content-type": "application/json",
        cookie: [...jar].map(([key, value]) => `${key}=${value}`).join("; "),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";", 1)[0];
      const equal = pair.indexOf("=");
      if (/max-age=0/i.test(cookie)) jar.delete(pair.slice(0, equal));
      else jar.set(pair.slice(0, equal), pair.slice(equal + 1));
    }
    return response;
  };
}
async function createAccount(label) {
  const email = `media-${label}-${randomBytes(8).toString("hex")}@aiverse.test`;
  const result = await internal.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { role: "admin" },
  });
  const user = check(result, "Create temporary local Auth account").user;
  created.push(user.id);
  const client = createClient(status.API_URL, status.ANON_KEY, options);
  check(await client.auth.signInWithPassword({ email, password }), "Real local password session");
  const request = browserSession();
  assert.equal(
    (await request("/api/auth", { action: "login", email, password })).status,
    200,
    "HTTP login creates session cookies",
  );
  return { id: user.id, email, client, request };
}
function localSql(sql) {
  return execFileSync(
    "docker",
    [
      "exec",
      "-i",
      "supabase_db_aiverse-ana",
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-q",
    ],
    {
      encoding: "utf8",
      input: sql,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
}
async function cleanup() {
  if (!created.length) return;
  for (const id of created) assert.match(id, /^[0-9a-f-]{36}$/i);
  for (const id of simulatedProviderIds) assert.match(id, /^[a-f0-9]{32}$/);
  const values = created.map((id) => `('${id}'::uuid)`).join(",");
  // No table-wide deletes or resets. The exact account UUIDs scope every path.
  localSql(`begin;
    create temporary table test_cleanup_users(id uuid primary key) on commit drop;
    insert into test_cleanup_users values ${values};
    create temporary table test_cleanup_videos on commit drop as select id from public.videos where owner_id in(select id from test_cleanup_users);
    create temporary table test_cleanup_versions on commit drop as select id from public.video_versions where video_id in(select id from test_cleanup_videos);
    create temporary table test_cleanup_reservations on commit drop as select id from public.upload_reservations where owner_id in(select id from test_cleanup_users);
    delete from public.provider_events where provider_uid in(select provider_uid from public.private_media_assets where reservation_id in(select id from test_cleanup_reservations))${simulatedProviderIds.length ? ` or provider_uid in(${simulatedProviderIds.map((id) => `'${id}'`).join(",")})` : ""};
    delete from public.media_deletion_jobs where asset_id in(select id from public.private_media_assets where reservation_id in(select id from test_cleanup_reservations));
    delete from public.upload_operations where reservation_id in(select id from test_cleanup_reservations);
    delete from public.private_media_assets where reservation_id in(select id from test_cleanup_reservations);
    delete from public.video_review_notes where version_id in(select id from test_cleanup_versions);
    delete from public.video_languages where version_id in(select id from test_cleanup_versions);
    update public.videos set active_version_id=null,latest_version_id=null where id in(select id from test_cleanup_videos);
    delete from public.upload_reservations where id in(select id from test_cleanup_reservations);
    delete from public.video_versions where id in(select id from test_cleanup_versions);
    delete from public.videos where id in(select id from test_cleanup_videos);
    delete from public.media_audit where actor_id in(select id from test_cleanup_users);
    delete from public.creator_applications where user_id in(select id from test_cleanup_users) or decided_by in(select id from test_cleanup_users);
    delete from public.role_audit where actor_id in(select id from test_cleanup_users) or target_id in(select id from test_cleanup_users);
    commit;`);
  for (const id of created)
    check(await internal.auth.admin.deleteUser(id), "Delete temporary local Auth account");
}

let failure;
try {
  // Sequential setup ensures a partial failure has no still-running account
  // creation when finally begins cleanup.
  const accounts = [];
  for (const label of ["owner", "other", "admin", "moderator"])
    accounts.push(await createAccount(label));
  const [owner, other, administrator, moderator] = accounts;
  check(
    await internal.from("user_roles").insert([
      { user_id: administrator.id, role: "admin" },
      { user_id: moderator.id, role: "moderator" },
    ]),
    "Bootstrap local test operator roles",
  );
  assert.deepEqual(
    check(await owner.client.from("user_roles").select("role"), "Read signup roles"),
    [{ role: "viewer" }],
    "Signup metadata cannot grant admin",
  );
  const applicationResponse = await owner.request("/api/creator/applications", {
    display_name: "Local test creator",
    handle: `test-${randomBytes(6).toString("hex")}`,
    bio: "Temporary local integration account.",
    portfolio_url: "https://example.com/test-portfolio",
    rights_attested: true,
  });
  assert.equal(applicationResponse.status, 201, "HTTP application submission");
  const { applicationId } = await applicationResponse.json();
  assert.equal(
    (
      await moderator.request("/api/moderation/decisions", {
        kind: "application",
        id: applicationId,
        approve: true,
        reason: "Must require administrator",
      })
    ).status,
    403,
  );
  const roleEscalation = await moderator.client.rpc("set_user_role", {
    target_user_id: other.id,
    requested_role: "creator",
    should_grant: true,
    decision_reason: "Moderator escalation denied",
  });
  assert.equal(roleEscalation.error?.code, "42501");
  assert.equal(
    (
      await administrator.request("/api/moderation/decisions", {
        kind: "application",
        id: applicationId,
        approve: true,
        reason: "Approved local test application",
      })
    ).status,
    200,
  );
  assert.deepEqual(
    check(
      await owner.client.from("user_roles").select("role").order("role"),
      "Creator role granted",
    ),
    [{ role: "creator" }, { role: "viewer" }],
  );
  assert.equal(
    check(await internal.from("role_audit").select("id").eq("target_id", owner.id), "Role audit")
      .length,
    1,
  );

  const versions = [];
  for (let index = 0; index < 4; index++) {
    const response = await owner.request("/api/studio/versions", {
      videoId: null,
      metadata: { ...metadata, title: `${metadata.title} ${index}` },
    });
    assert.equal(response.status, 201, "HTTP private draft creation");
    versions.push((await response.json()).version);
  }
  assert.equal(
    check(
      await other.client
        .from("video_versions")
        .select("id")
        .in(
          "id",
          versions.map((version) => version.version_id),
        ),
      "Cross-user version read",
    ).length,
    0,
  );
  assert.equal(
    (
      await other.client.rpc("reserve_video_upload", {
        version_id: versions[0].version_id,
        idempotency_key: `malicious-${randomBytes(8).toString("hex")}`,
      })
    ).error?.code,
    "42501",
  );
  assert.equal(
    (
      await owner.client.rpc("reconcile_video_provider", {
        event_key: "forged",
        provider_uid: "forged",
        provider_state: "ready",
        actual_duration_seconds: 90,
        operation_key: null,
      })
    ).error?.code,
    "42501",
  );
  assert.equal((await guest.from("video_versions").select("id")).error?.code, "42501");

  const keys = versions.map(() => `concurrent-${randomBytes(12).toString("hex")}`);
  // Independent HTTP/PostgREST requests race for the same owner-row lock.
  const results = await Promise.all(
    versions.map((version, index) =>
      owner.client.rpc("reserve_video_upload", {
        version_id: version.version_id,
        idempotency_key: keys[index],
      }),
    ),
  );
  const successful = results.flatMap((result, index) =>
    result.error ? [] : [{ ...result.data, index }],
  );
  const denied = results.filter((result) => result.error);
  assert.equal(successful.length, 3, "Exactly three concurrent reservations fit the daily limit");
  assert.equal(denied.length, 1);
  assert.equal(denied[0].error.code, "22023");
  assert.equal(
    successful.every((item) => item.provider_uid === null),
    true,
    "Browser RPC never exposes provider IDs",
  );
  const selected = successful[0];
  const selectedVersion = versions[selected.index];
  const repeated = await rpc(owner.client, "reserve_video_upload", {
    version_id: selectedVersion.version_id,
    idempotency_key: keys[selected.index],
  });
  assert.equal(
    repeated.reservation_id,
    selected.reservation_id,
    "Retry returns exactly the original hold despite full daily quota",
  );
  const firstClaim = await rpc(internal, "begin_upload_grant", {
    reservation_id: selected.reservation_id,
  });
  assert.equal(firstClaim.lease, true);
  assert.equal(
    (await rpc(internal, "begin_upload_grant", { reservation_id: selected.reservation_id })).lease,
    false,
  );
  const providerId = randomBytes(16).toString("hex");
  simulatedProviderIds.push(providerId);
  // Test-only simulated trusted-provider facts. No Cloudflare request or binary upload.
  await rpc(internal, "bind_video_provider", {
    reservation_id: selected.reservation_id,
    provider_uid: providerId,
  });
  // An already-bound operation cannot reach Cloudflare even if a later operator
  // configures provider credentials before rerunning this local test.
  const beforeDisabled = check(
    await owner.client.from("upload_reservations").select("id"),
    "Existing holds",
  ).length;
  const disabledResponse = await owner.request("/api/studio/uploads", {
    versionId: selectedVersion.version_id,
    idempotencyKey: keys[selected.index],
  });
  assert.ok(
    [503, 409].includes(disabledResponse.status),
    "Unconfigured services or a non-retryable operation denies another external grant",
  );
  assert.equal(
    check(await owner.client.from("upload_reservations").select("id"), "Unchanged holds").length,
    beforeDisabled,
  );
  const eventKey = `test-ready-${randomBytes(12).toString("hex")}`;
  assert.equal(
    (
      await rpc(internal, "reconcile_video_provider", {
        event_key: eventKey,
        provider_uid: providerId,
        provider_state: "ready",
        actual_duration_seconds: 90,
        operation_key: null,
      })
    ).state,
    "pending_review",
  );
  assert.equal(
    (
      await rpc(internal, "reconcile_video_provider", {
        event_key: eventKey,
        provider_uid: providerId,
        provider_state: "ready",
        actual_duration_seconds: 90,
        operation_key: null,
      })
    ).duplicate,
    true,
  );
  assert.equal(
    await rpc(internal, "playback_entitlement", {
      video_id: selectedVersion.video_id,
      viewer_id: other.id,
      requested_version_id: null,
    }),
    null,
  );
  const preview = await rpc(internal, "playback_entitlement", {
    video_id: selectedVersion.video_id,
    viewer_id: moderator.id,
    requested_version_id: selectedVersion.version_id,
  });
  assert.equal(preview.version_id, selectedVersion.version_id);
  assert.ok(
    Date.parse(preview.expires_at) - Date.now() <= 151000,
    "Verified 90-second media entitlement bounded to duration plus 60 seconds",
  );
  assert.equal(
    (
      await moderator.request("/api/moderation/decisions", {
        kind: "version",
        id: selectedVersion.version_id,
        approve: true,
        reason: "Reviewed exact local test revision",
      })
    ).status,
    200,
  );
  const publicRows = check(
    await guest.from("public_catalog").select("*").eq("id", selectedVersion.video_id),
    "Guest public projection",
  );
  assert.equal(publicRows.length, 1);
  assert.equal(publicRows[0].version_id, selectedVersion.version_id);
  for (const field of [
    "provider_uid",
    "rights_declaration",
    "metadata",
    "decision_reason",
    "reviewed_by",
  ])
    assert.equal(Object.hasOwn(publicRows[0], field), false);
  const revisionResponse = await owner.request("/api/studio/versions", {
    videoId: selectedVersion.video_id,
    metadata: { ...metadata, title: "Unreviewed local revision" },
  });
  assert.equal(revisionResponse.status, 201);
  assert.equal(
    check(
      await guest.from("public_catalog").select("version_id").eq("id", selectedVersion.video_id),
      "Approved version remains stable",
    )[0].version_id,
    selectedVersion.version_id,
  );

  // An unknown grant outcome stays non-retryable until trusted evidence recovers it.
  const uncertain = successful[1];
  const recoveredId = randomBytes(16).toString("hex");
  simulatedProviderIds.push(recoveredId);
  await rpc(internal, "begin_upload_grant", { reservation_id: uncertain.reservation_id });
  await rpc(internal, "mark_upload_grant_failure", {
    reservation_id: uncertain.reservation_id,
    known_no_asset: false,
    error_message: "Local test: ambiguous provider outcome",
  });
  assert.equal(
    (await rpc(internal, "begin_upload_grant", { reservation_id: uncertain.reservation_id })).lease,
    false,
  );
  assert.equal(
    (
      await rpc(internal, "reconcile_video_provider", {
        event_key: `test-recovery-${recoveredId}`,
        provider_uid: recoveredId,
        provider_state: "ready",
        actual_duration_seconds: 45,
        operation_key: uncertain.reservation_id,
      })
    ).state,
    "pending_review",
  );
  const cancelled = successful[2];
  const cancelledId = randomBytes(16).toString("hex");
  simulatedProviderIds.push(cancelledId);
  await rpc(internal, "begin_upload_grant", { reservation_id: cancelled.reservation_id });
  await rpc(internal, "mark_upload_grant_failure", {
    reservation_id: cancelled.reservation_id,
    known_no_asset: true,
    error_message: "Local test: known failure before asset creation",
  });
  assert.equal(
    (
      await rpc(internal, "reconcile_video_provider", {
        event_key: `test-cancelled-${cancelledId}`,
        provider_uid: cancelledId,
        provider_state: "ready",
        actual_duration_seconds: 45,
        operation_key: cancelled.reservation_id,
      })
    ).ignored,
    true,
  );

  assert.equal(
    (
      await moderator.request("/api/moderation/decisions", {
        kind: "video",
        id: selectedVersion.video_id,
        action: "hide",
        reason: "Local hide and revocation test",
      })
    ).status,
    200,
  );
  assert.equal(
    check(
      await guest.from("public_catalog").select("id").eq("id", selectedVersion.video_id),
      "Hidden projection",
    ).length,
    0,
  );
  assert.equal(
    await rpc(internal, "playback_entitlement", {
      video_id: selectedVersion.video_id,
      viewer_id: owner.id,
      requested_version_id: null,
    }),
    null,
  );
  assert.equal(
    (
      await rpc(internal, "reconcile_video_provider", {
        event_key: `test-late-${providerId}`,
        provider_uid: providerId,
        provider_state: "ready",
        actual_duration_seconds: 90,
        operation_key: null,
      })
    ).ignored,
    true,
  );
  assert.equal(
    check(
      await owner.client.from("videos").select("state").eq("id", selectedVersion.video_id),
      "Late callback state",
    )[0].state,
    "hidden",
  );
  const ownAssets = check(
    await internal
      .from("private_media_assets")
      .select("id")
      .in("provider_uid", simulatedProviderIds),
    "Test asset identities",
  );
  const ownJobs = check(
    await internal
      .from("media_deletion_jobs")
      .select("id")
      .in(
        "asset_id",
        ownAssets.map((asset) => asset.id),
      ),
    "Durable deletion jobs",
  );
  assert.equal(ownJobs.length, 2, "Hidden and cancelled assets have durable deletion jobs");
  assert.equal(
    (await owner.client.rpc("claim_media_deletions", { batch_size: 1 })).error?.code,
    "42501",
  );
  // Seed leases only for these exact jobs, rather than claiming the global queue
  // and affecting another test/operator's pending deletion. The global claim and
  // contention algorithm is exercised by media-rls.test.ts.
  const jobIds = ownJobs.map((job) => {
    assert.match(job.id, /^[0-9a-f-]{36}$/i);
    return `'${job.id}'::uuid`;
  });
  localSql(
    `update public.media_deletion_jobs set state='processing',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes' where id in(${jobIds.join(",")});`,
  );
  const leasedJobs = check(
    await internal
      .from("media_deletion_jobs")
      .select("id,lease_token")
      .in(
        "id",
        ownJobs.map((job) => job.id),
      ),
    "Exact local test leases",
  );
  for (const job of leasedJobs)
    await rpc(internal, "finish_media_deletion", {
      job_id: job.id,
      lease_token: job.lease_token,
      succeeded: false,
      error_message: "Local integration test: no external deletion was attempted",
    });
  assert.equal(
    (await browserSession()("/api/internal/media", {})).status,
    401,
    "Unauthenticated worker is denied",
  );
  assert.ok(
    [503, 404].includes(
      (await browserSession()(`/api/playback/${selectedVersion.video_id}`)).status,
    ),
    "Unconfigured or hidden playback never reaches the provider",
  );
  console.log(
    "PASS: real local Auth/PostgREST creator approval, 4-way concurrent quota (3 allowed/1 denied), idempotency, private RLS, version-bound publish, revision isolation, hide/playback denial, callback replay, unknown/cancelled operation recovery, durable deletion leases. Provider evidence was simulated locally; no Cloudflare I/O.",
  );
} catch (error) {
  failure = error;
} finally {
  try {
    await cleanup();
  } catch (error) {
    failure = failure ?? error;
    console.error(
      "Local media cleanup failed; inspect only temporary media-* Auth accounts before rerunning.",
    );
  }
}
if (failure) {
  // Never dump request/session objects, captured CLI output, or credentials.
  console.error(
    `FAIL: ${failure instanceof Error ? failure.message : "local media integration failed"}`,
  );
  process.exitCode = 1;
}
