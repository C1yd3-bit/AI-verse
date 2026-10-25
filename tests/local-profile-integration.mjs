import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import nextEnv from "@next/env";

// Exact synthetic fixtures in the dedicated local stack only. No provider I/O,
// captured credentials, real recipients, hosted projects or persistent test roles.
assert.match(
  readFileSync(new URL("../supabase/config.toml", import.meta.url), "utf8"),
  /^project_id\s*=\s*"aiverse-ana"\s*$/m,
);
let status;
try {
  status = JSON.parse(
    execFileSync(
      process.platform === "win32" ? "supabase.exe" : "supabase",
      ["status", "-o", "json"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ),
  );
} catch {
  throw new Error("Dedicated local Supabase status is unavailable");
}
assert.equal(status.API_URL, "http://127.0.0.1:55321");
const base = "http://127.0.0.1:3000";
const env = nextEnv.loadEnvConfig(process.cwd(), true, { info() {}, error() {} }).combinedEnv;
assert.equal(
  env.NEXT_PUBLIC_SUPABASE_URL,
  status.API_URL,
  "App must use the dedicated local backend",
);
assert.ok(
  !env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY === status.PUBLISHABLE_KEY,
  "Unexpected public-key override",
);
assert.notEqual(env.AIVERSE_ENABLE_STREAM_UPLOADS, "true", "This test must leave uploads disabled");
const options = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
};
const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, options);
const guest = createClient(status.API_URL, status.ANON_KEY, options);
const created = [];
const sessions = [];
const password = randomBytes(24).toString("base64url");
function check(result, message) {
  const code = result.error?.code;
  assert.ok(
    !result.error,
    `${message}${typeof code === "string" && /^[A-Z0-9_]{1,32}$/i.test(code) ? ` [${code}]` : ""}`,
  );
  return result.data;
}
function localSql(sql) {
  try {
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
        "-t",
        "-A",
      ],
      { input: sql, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
    );
  } catch {
    throw new Error("Exact local fixture SQL failed; captured output was suppressed");
  }
}
assert.equal(
  localSql(
    "select to_regprocedure('public.get_my_profile()') is not null and to_regprocedure('public.set_my_appearance(text)') is not null and to_regprocedure('public.update_my_account_information(jsonb)') is not null;",
  ).trim(),
  "t",
  "Apply local migration 011 before running this test",
);
function browser(accountId) {
  const jar = new Map();
  return async (path, body, expectedAccountId = accountId) => {
    const target = new URL(path, base);
    assert.equal(target.origin, base, "Cookies stay on the local application");
    let response;
    try {
      response = await fetch(target, {
        method: body ? "POST" : "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(15000),
        headers: {
          origin: base,
          "content-type": "application/json",
          ...(expectedAccountId ? { "x-aiverse-account": expectedAccountId } : {}),
          cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; "),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new Error("Local profile HTTP request failed or timed out");
    }
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";", 1)[0],
        equal = pair.indexOf("=");
      if (/max-age=0/i.test(cookie)) jar.delete(pair.slice(0, equal));
      else jar.set(pair.slice(0, equal), pair.slice(equal + 1));
    }
    return response;
  };
}
async function account(label) {
  const email = `profile-${label}-${randomBytes(8).toString("hex")}@aiverse.test`;
  const user = check(
    await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { role: "admin" },
    }),
    "Create exact synthetic local account",
  ).user;
  assert.ok(user, "Temporary user exists");
  created.push(user.id);
  const client = createClient(status.API_URL, status.ANON_KEY, options),
    request = browser(user.id);
  check(
    await client.auth.signInWithPassword({ email, password }),
    "Local fixture password session",
  );
  sessions.push({ client, request });
  assert.equal(
    (await request("/api/auth", { action: "login", email, password })).status,
    200,
    "HTTP login establishes cookie session",
  );
  return { id: user.id, email, client, request };
}
async function snapshot(user) {
  const response = await user.request("/api/me/profile");
  assert.equal(response.status, 200, "Private profile reads successfully");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  return response.json();
}
async function cleanup() {
  if (!created.length) return;
  for (const id of created) assert.match(id, /^[0-9a-f-]{36}$/i);
  const ids = created.map((id) => `'${id}'::uuid`).join(",");
  // Synthetic media is metadata-only; these exact owners never create grants,
  // assets, moderation, reservations, deletion jobs or external media resources.
  localSql(`begin;
    create temporary table profile_test_users(id uuid primary key) on commit drop;
    insert into profile_test_users select unnest(array[${ids}]);
    create temporary table profile_test_videos on commit drop as select id from public.videos where owner_id in(select id from profile_test_users);
    delete from public.watch_completions where user_id in(select id from profile_test_users) or video_id in(select id from profile_test_videos);
    delete from public.video_signals where user_id in(select id from profile_test_users) or video_id in(select id from profile_test_videos);
    delete from public.video_languages where version_id in(select id from public.video_versions where video_id in(select id from profile_test_videos));
    update public.videos set latest_version_id=null,active_version_id=null where id in(select id from profile_test_videos);
    delete from public.video_versions where video_id in(select id from profile_test_videos);
    delete from public.videos where id in(select id from profile_test_videos);
    delete from public.creator_applications where user_id in(select id from profile_test_users);
    commit;`);
  for (const session of sessions) {
    await session.request("/api/auth", { action: "logout" });
    await session.client.auth.signOut();
  }
  for (const id of created)
    check(await admin.auth.admin.deleteUser(id), "Remove exact local profile account");
  for (const table of [
    "profiles",
    "user_roles",
    "account_details",
    "account_settings",
    "viewer_preferences",
  ])
    assert.equal(
      check(
        await admin
          .from(table)
          .select("*")
          .in(table === "profiles" ? "id" : "user_id", created),
        "Verify exact profile fixture cleanup",
      ).length,
      0,
      `${table} fixture records removed`,
    );
  assert.equal(
    localSql(`select count(*) from auth.users where id in(${ids});`).trim(),
    "0",
    "Exact Auth fixtures removed",
  );
}
let failure;
try {
  assert.equal((await browser()("/api/me/profile")).status, 401, "Guest profile denied");
  assert.ok((await guest.rpc("get_my_profile")).error, "Anonymous profile RPC denied");
  const owner = await account("owner"),
    other = await account("other"),
    unverified = await account("unverified");
  assert.equal((await snapshot(owner)).account, null, "Missing private onboarding remains missing");
  assert.equal((await snapshot(owner)).appearance.theme, "dark", "Account default is dark");
  const onboarding = {
    fullName: "Private profile fixture",
    age: 30,
    contactNumber: "+1 555 123 4567",
    preferences: {
      status: "completed",
      genres: ["fantasy", "sci-fi", "comedy", "horror", "animals"],
      regions: ["korean"],
    },
    ethnicity: "Optional private test description",
    ethnicityConsent: true,
  };
  assert.equal(
    (await owner.request("/api/me/onboarding", onboarding)).status,
    200,
    "Complete exact owner onboarding",
  );
  const before = check(
    await owner.client
      .from("account_details")
      .select("ethnicity,ethnicity_consent,ethnicity_consented_at,completed_at")
      .eq("user_id", owner.id)
      .single(),
    "Capture private fields that must be preserved",
  );
  const preferencesBefore = check(
    await owner.client
      .from("viewer_preferences")
      .select("status,genres,regions")
      .eq("user_id", owner.id)
      .single(),
    "Owner interests before patch",
  );
  const rolesBefore = check(
    await owner.client.from("user_roles").select("role").eq("user_id", owner.id),
    "Owner roles before patch",
  );
  assert.deepEqual(
    rolesBefore,
    [{ role: "viewer" }],
    "Signup metadata does not grant creator/admin privileges",
  );
  for (const expectedAccountId of [null, other.id]) {
    for (const body of [
      { action: "appearance", theme: "light" },
      { action: "account", fullName: "Wrong visible account", age: 30, contactNumber: null },
    ])
      assert.equal(
        (await owner.request("/api/me/profile", body, expectedAccountId)).status,
        409,
        "Missing/stale visible account precondition rejects before mutation",
      );
  }
  assert.equal(
    (await snapshot(owner)).appearance.theme,
    "dark",
    "Rejected stale appearance save leaves owner unchanged",
  );
  assert.equal(
    (await snapshot(owner)).account.fullName,
    onboarding.fullName,
    "Rejected stale basics save leaves owner unchanged",
  );
  assert.equal(
    (await owner.request("/api/me/profile", { action: "appearance", theme: "light" })).status,
    200,
  );
  assert.equal((await snapshot(owner)).appearance.theme, "light", "Appearance persists on reread");
  assert.equal(
    (await snapshot(other)).appearance.theme,
    "dark",
    "Second account keeps its own default",
  );
  assert.deepEqual(
    check(
      await other.client.from("account_settings").select("*").eq("user_id", owner.id),
      "Cross-owner theme read",
    ),
    [],
  );
  assert.ok(
    (await owner.client.from("account_settings").update({ theme: "dark" }).eq("user_id", owner.id))
      .error,
    "Direct theme writes denied",
  );
  assert.ok(
    (
      await owner.client
        .from("account_details")
        .update({ full_name: "Bypassed" })
        .eq("user_id", owner.id)
    ).error,
    "Direct private account writes denied",
  );
  for (const input of [
    { action: "account", ...onboarding, userId: other.id },
    { action: "appearance", theme: "light", userId: other.id },
    { action: "account", fullName: "Injected", age: 30, contactNumber: null, role: "admin" },
    { action: "account", fullName: "😀".repeat(41), age: 30, contactNumber: null },
  ])
    assert.equal(
      (await owner.request("/api/me/profile", input)).status,
      400,
      "Malformed/owner/privilege injection denied",
    );
  assert.ok(
    (
      await owner.client.rpc("update_my_account_information", {
        payload: { fullName: "Injection", age: 30, contactNumber: null, userId: other.id },
      })
    ).error,
    "Direct RPC owner spoof denied",
  );
  assert.equal(
    (
      await owner.request("/api/me/profile", {
        action: "account",
        fullName: "Updated Private Name",
        age: 31,
        contactNumber: null,
      })
    ).status,
    200,
  );
  const updated = await snapshot(owner);
  assert.equal(updated.accountId, owner.id);
  assert.equal(updated.account.fullName, "Updated Private Name");
  assert.equal(updated.account.email, owner.email, "Email comes from the verified Auth identity");
  assert.equal(updated.uploadsAvailable, false, "Uploads remain disabled");
  assert.ok(
    !JSON.stringify(updated).includes("ethnicity"),
    "Ordinary profile payload omits sensitive description",
  );
  assert.deepEqual(
    check(
      await owner.client
        .from("account_details")
        .select("ethnicity,ethnicity_consent,ethnicity_consented_at,completed_at")
        .eq("user_id", owner.id)
        .single(),
      "Private preservation",
    ),
    before,
  );
  assert.deepEqual(
    check(
      await owner.client
        .from("viewer_preferences")
        .select("status,genres,regions")
        .eq("user_id", owner.id)
        .single(),
      "Interest preservation",
    ),
    preferencesBefore,
  );
  assert.deepEqual(
    check(
      await owner.client.from("user_roles").select("role").eq("user_id", owner.id),
      "Role preservation",
    ),
    rolesBefore,
  );
  assert.equal(
    check(
      await admin.from("profiles").select("display_name").eq("id", owner.id).single(),
      "Public alias stays separate",
    ).display_name,
    "",
  );
  assert.deepEqual(
    check(
      await other.client.from("account_details").select("*").eq("user_id", owner.id),
      "Cross-owner private information read",
    ),
    [],
  );
  assert.equal(
    (
      await other.request("/api/me/profile", {
        action: "account",
        fullName: "No onboarding",
        age: 25,
        contactNumber: null,
      })
    ).status,
    400,
    "Account patch cannot bypass onboarding",
  );
  // Seed clearly simulated content/state and engagement into exact fixture UUIDs.
  // No provider asset exists and this is not evidence of real views/playback.
  const rows = Array.from({ length: 24 }, (_, i) => ({
    id: randomUUID(),
    owner_id: owner.id,
    state: i === 23 ? "removed" : i === 22 ? "hidden" : i === 21 ? "draft" : "published",
    created_at: new Date(Date.now() + i * 1000).toISOString(),
  }));
  const extra = {
    id: randomUUID(),
    owner_id: other.id,
    state: "draft",
    created_at: new Date().toISOString(),
  };
  check(await admin.from("videos").insert([...rows, extra]), "Seed exact synthetic owner media");
  const versions = rows.map((row, i) => ({
    id: randomUUID(),
    video_id: row.id,
    revision: 1,
    metadata: { title: `Synthetic profile film ${i + 1}`, format: "reel" },
    state: i >= 22 ? "rejected" : i === 21 ? "draft" : i === 20 ? "pending_review" : "published",
    duration_seconds: 90,
  }));
  check(await admin.from("video_versions").insert(versions), "Seed synthetic versions");
  for (let i = 0; i < rows.length; i++)
    check(
      await admin
        .from("videos")
        .update({
          latest_version_id: versions[i].id,
          active_version_id: rows[i].state === "published" ? versions[i].id : null,
        })
        .eq("id", rows[i].id),
      "Connect exact fixture version",
    );
  check(
    await admin.from("video_signals").insert(
      [rows[0], rows[22], rows[23], extra].map((row) => ({
        user_id: other.id,
        video_id: row.id,
        signal: "like",
      })),
    ),
    "Seed recorded likes including excluded and other-owner cases",
  );
  const today = new Date().toISOString().slice(0, 10),
    yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  check(
    await admin.from("watch_completions").insert(
      [
        [0, true, today],
        [0, true, yesterday],
        [22, false, today],
        [23, true, today],
      ].map(([n, credited, day]) => ({
        user_id: other.id,
        session_key: randomUUID(),
        video_id: rows[n].id,
        version_id: versions[n].id,
        watched_seconds: 90,
        duration_seconds: 90,
        user_initiated: true,
        credited,
        recorded_day: day,
      })),
    ),
    "Seed retained daily completion credits",
  );
  const stats = await snapshot(owner);
  assert.deepEqual(
    stats.stats,
    { total: 23, published: 21, pendingReview: 1, drafts: 1, likes: 2, creditedCompletions: 2 },
    "Summaries count all retained own media and recorded events",
  );
  assert.equal(stats.content.length, 20, "Recent content is bounded independently from totals");
  assert.ok(
    !stats.content.some((row) => row.id === rows[0].id),
    "Oldest liked media is beyond recent20 but included in totals",
  );
  assert.equal(stats.content[0].state, "hidden", "Hidden content remains manageable");
  assert.ok(
    !JSON.stringify(stats).match(/provider_uid|session_key|user_id|ethnicity/),
    "Snapshot reveals no provider/viewer identifiers or ethnicity",
  );
  assert.deepEqual(
    check(
      await owner.client.from("watch_completions").select("user_id"),
      "Other viewers' event rows remain private",
    ),
    [],
  );
  const otherStats = await snapshot(other);
  assert.equal(otherStats.stats.total, 1, "Other owner sees only own content");
  assert.equal(otherStats.stats.likes, 1);
  assert.deepEqual(
    otherStats.content.map((row) => row.id),
    [extra.id],
  );
  assert.equal(
    (await snapshot(owner)).creator.approved,
    false,
    "Content statistics never grant creator privileges",
  );
  // Downgrade only this exact fixture after authenticating to exercise the real
  // cookie and PostgREST paths with an unverified identity, without sending mail.
  assert.match(unverified.id, /^[0-9a-f-]{36}$/i);
  localSql(`update auth.users set email_confirmed_at=null where id='${unverified.id}'::uuid;`);
  assert.equal(
    (await unverified.request("/api/me/profile")).status,
    403,
    "Unverified cookie identity cannot read profile",
  );
  assert.equal(
    (await unverified.request("/api/me/profile", { action: "appearance", theme: "light" })).status,
    403,
    "Unverified cookie identity cannot mutate appearance",
  );
  assert.ok(
    (await unverified.client.rpc("get_my_profile")).error,
    "Unverified direct profile RPC denied",
  );
  assert.ok(
    (await unverified.client.rpc("set_my_appearance", { requested_theme: "light" })).error,
    "Unverified direct appearance RPC denied",
  );
} catch (error) {
  failure = error;
} finally {
  try {
    await cleanup();
  } catch {
    failure = failure ?? new Error("Exact local profile fixture cleanup was incomplete");
    console.error("Inspect only exact temporary profile-* fixtures; no broad reset was attempted.");
  }
}
if (failure) {
  console.error(
    `FAIL: ${failure instanceof Error ? failure.message : "local profile integration failed"}`,
  );
  process.exitCode = 1;
} else
  console.log(
    "PASS: real local cookie/PostgREST private profile, per-account appearance, private basics preservation, owner isolation, recorded content totals beyond recent20, unverified denial and exact fixture cleanup. Media/engagement facts were synthetic local fixtures; no provider I/O or email.",
  );
