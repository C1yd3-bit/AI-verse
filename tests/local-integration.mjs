import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { createClient } from "@supabase/supabase-js";
import nextEnv from "@next/env";

// Intentionally local-only: never create or delete accounts in a hosted project.
const status = JSON.parse(
  execFileSync(
    process.platform === "win32" ? "supabase.exe" : "supabase",
    ["status", "-o", "json"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ),
);
assert.equal(status.API_URL, "http://127.0.0.1:55321", "Expected isolated aiverse-ana local stack");
const base = "http://127.0.0.1:3000";
const mailpit = "http://127.0.0.1:55324";
const env = nextEnv.loadEnvConfig(process.cwd(), true, { info() {}, error() {} }).combinedEnv;
assert.ok(
  env.NEXT_PUBLIC_SUPABASE_URL === status.API_URL,
  "The preview environment must target the isolated local Supabase stack before signup testing",
);
const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const created = [];
const capturedMessages = new Set();
let signupEmail;
const password = randomBytes(24).toString("base64url");
async function localFetch(url, options = {}) {
  const target = new URL(url);
  assert.ok(
    [base, status.API_URL, mailpit].includes(target.origin) && !target.username && !target.password,
    "Integration requests are restricted to the three isolated loopback services",
  );
  try {
    return await fetch(target, {
      ...options,
      redirect: "manual",
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    // Confirmation URLs contain credentials. Never include fetch errors or URLs.
    throw new Error("An isolated local integration request failed or timed out");
  }
}
function browserSession() {
  const jar = new Map();
  return async function request(path, body, method = body ? "POST" : "GET") {
    const target = new URL(path, base);
    assert.ok(target.origin === base, "Application cookies may only be sent to the local preview");
    const response = await localFetch(target, {
      method,
      redirect: "manual",
      headers: {
        origin: base,
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
async function ownSignupUser() {
  if (!signupEmail) return null;
  assert.ok(/^confirmation-[a-f0-9]+@aiverse\.test$/.test(signupEmail));
  for (let page = 1; page <= 10; page++) {
    const result = await admin.auth.admin.listUsers({ page, perPage: 100 });
    assert.ok(!result.error, "Could not inspect the local signup account for cleanup");
    const match = result.data.users.find((user) => user.email === signupEmail);
    if (match) return match;
    if (result.data.users.length < 100) return null;
  }
  throw new Error("Local Auth has too many users for the bounded cleanup lookup");
}
async function confirmationMessage(email) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const response = await localFetch(`${mailpit}/api/v1/messages?limit=200`);
    assert.equal(response.status, 200, "Local captured-email list is available");
    const listing = await response.json();
    const matching = listing.messages.filter((message) =>
      message.To?.some((recipient) => recipient.Address === email),
    );
    for (const message of matching) {
      assert.ok(typeof message.ID === "string" && /^[A-Za-z0-9_-]+$/.test(message.ID));
      capturedMessages.add(message.ID);
    }
    if (matching.length) {
      assert.equal(matching.length, 1, "Exactly one confirmation belongs to this unique recipient");
      const message = await localFetch(`${mailpit}/api/v1/message/${matching[0].ID}`);
      assert.equal(message.status, 200);
      const full = await message.json();
      assert.ok(
        full.To?.some((recipient) => recipient.Address === email),
        "Only the exact test recipient's message may be opened",
      );
      return full;
    }
    await delay(250);
  }
  throw new Error("The local confirmation email was not captured within ten seconds");
}
function confirmationCode(message) {
  const token = String(message.HTML ?? "").match(/<strong>\s*(\d{6})\s*<\/strong>/i)?.[1];
  assert.ok(token && /^\d{6}$/.test(token), "Expected the local six-digit confirmation code");
  return token;
}
try {
  const users = [];
  for (const name of ["alice", "bob"]) {
    const email = `${name}-${randomBytes(6).toString("hex")}@aiverse.test`;
    const result = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { role: "admin" },
    });
    assert.ifError(result.error);
    created.push(result.data.user.id);
    users.push({ email, id: result.data.user.id, request: browserSession() });
  }
  const [alice, bob] = users;
  assert.equal((await browserSession()("/api/me/preferences")).status, 401);
  for (const user of users) {
    const login = await user.request("/api/auth", { action: "login", email: user.email, password });
    assert.equal(login.status, 200, "HTTP login and cookie creation");
    const preferences = await user.request("/api/me/preferences");
    assert.equal(preferences.status, 200, "Cookie session survives next request");
    assert.equal((await preferences.json()).preferences, null);
  }
  const selection = {
    status: "completed",
    genres: ["fantasy", "sci-fi", "comedy", "horror", "animals"],
    regions: ["korean"],
  };
  assert.equal((await alice.request("/api/me/preferences", selection)).status, 200);
  assert.deepEqual(
    (await (await alice.request("/api/me/preferences")).json()).preferences,
    selection,
  );
  assert.equal(
    (await (await bob.request("/api/me/preferences")).json()).preferences,
    null,
    "Second account cannot see Alice preferences",
  );
  assert.equal(
    (await alice.request("/api/me/preferences", { ...selection, user_id: bob.id })).status,
    400,
  );
  const viewerClient = createClient(status.API_URL, status.ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  assert.ifError(
    (await viewerClient.auth.signInWithPassword({ email: alice.email, password })).error,
  );
  const roles = await viewerClient.from("user_roles").select("role");
  assert.ifError(roles.error);
  assert.deepEqual(roles.data, [{ role: "viewer" }], "Signup metadata cannot grant admin");
  const other = await viewerClient
    .from("viewer_preferences")
    .select("user_id")
    .eq("user_id", bob.id);
  assert.ifError(other.error);
  assert.deepEqual(other.data, []);
  const escalation = await viewerClient.rpc("set_user_role", {
    target_user_id: bob.id,
    requested_role: "admin",
    should_grant: true,
    decision_reason: "Malicious grant denied",
  });
  assert.equal(escalation.error?.code, "42501");

  // Real HTTP SELECTs catch schema/column drift that mock route tests cannot.
  for (const user of users) {
    const library = await user.request("/api/me/library");
    assert.equal(library.status, 200, "Library HTTP columns exist in the real local database");
    assert.deepEqual(await library.json(), { fusions: [], signals: [], follows: [] });
    const reports = await user.request("/api/reports");
    assert.equal(reports.status, 200, "Report HTTP columns exist");
    assert.deepEqual(await reports.json(), { reports: [] });
    const appeals = await user.request("/api/me/appeals");
    assert.equal(appeals.status, 200, "Suspension and appeal HTTP columns exist");
    assert.deepEqual(await appeals.json(), { suspensions: [], appeals: [] });
    const studio = await user.request("/api/studio");
    assert.equal(studio.status, 200, "Studio HTTP columns exist");
    assert.deepEqual(await studio.json(), { roles: ["viewer"], videos: [], versions: [] });
    assert.equal(
      (await user.request("/api/operations")).status,
      403,
      "Viewers cannot open operations",
    );
  }
  const savedQuery = {
    keywords: ["cat"],
    regions: ["korean"],
    genres: ["romance"],
    formats: ["reel"],
    languages: ["english"],
    hashtags: [],
    maxDurationSeconds: 120,
  };
  const save = await alice.request("/api/me/library", {
    action: "save_fusion",
    id: null,
    name: "Local integration mix",
    query: savedQuery,
  });
  assert.equal(save.status, 200, "Account-backed Fusion save works over HTTP");
  const filterId = (await save.json()).id;
  assert.ok(typeof filterId === "string");
  const aliceLibrary = await (await alice.request("/api/me/library")).json();
  assert.equal(aliceLibrary.fusions.length, 1);
  assert.equal(aliceLibrary.fusions[0].id, filterId);
  assert.deepEqual(aliceLibrary.fusions[0].query, savedQuery);
  assert.deepEqual((await (await bob.request("/api/me/library")).json()).fusions, []);
  assert.equal(
    (await bob.request("/api/me/library", { action: "delete_fusion", id: filterId })).status,
    403,
  );
  assert.equal(
    (await alice.request("/api/me/library", { action: "delete_fusion", id: filterId })).status,
    200,
  );
  assert.deepEqual((await (await alice.request("/api/me/library")).json()).fusions, []);

  // The two local-only accounts above must have authenticated through the app
  // before signup can trigger SMTP. Mailpit captures the .test address locally.
  signupEmail = `confirmation-${randomBytes(8).toString("hex")}@aiverse.test`;
  const signup = browserSession();
  const signupResponse = await signup("/api/auth", {
    action: "signup",
    email: signupEmail,
    password,
  });
  assert.equal(signupResponse.status, 200, "Application signup succeeds against local Auth");
  assert.equal((await signupResponse.json()).confirmationRequired, true);
  const pending = await ownSignupUser();
  assert.ok(pending, "Signup created the exact local test account");
  created.push(pending.id);
  assert.ok(
    !pending.email_confirmed_at,
    "The test account is unconfirmed before entering the code",
  );
  assert.equal((await signup("/api/me/preferences")).status, 401);
  const token = confirmationCode(await confirmationMessage(signupEmail));
  const verification = await signup("/api/auth", {
    action: "verify_signup",
    email: signupEmail,
    code: token,
  });
  assert.equal(
    verification.status,
    200,
    "Captured code verifies the local account and sets cookies",
  );
  assert.equal((await verification.json()).next, "/onboarding", "Verified signup opens onboarding");
  assert.equal(
    (await signup("/api/me/preferences")).status,
    200,
    "Confirmed signup has an authenticated cookie session",
  );
  assert.equal((await signup("/api/me/preferences", selection)).status, 200);
  assert.deepEqual((await (await signup("/api/me/preferences")).json()).preferences, selection);
  const confirmed = await admin.auth.admin.getUserById(pending.id);
  assert.ok(
    !confirmed.error && confirmed.data.user.email_confirmed_at,
    "Local email verification is recorded by Auth",
  );
  assert.equal((await signup("/api/auth", { action: "logout" })).status, 200);
  assert.equal((await signup("/api/me/preferences")).status, 401);
  assert.equal((await signup("/api/me/library")).status, 401);

  assert.equal((await alice.request("/api/auth", { action: "logout" })).status, 200);
  assert.equal((await alice.request("/api/me/preferences")).status, 401);
  assert.equal((await alice.request("/api/me/library")).status, 401);
  console.log(
    "PASS: local signup with a Mailpit verification code and authenticated cookies; login/logout, preferences, owner library save/delete, cross-account isolation, viewer operations denial and real studio/report/appeal HTTP queries.",
  );
} finally {
  const cleanupErrors = [];
  // Capture a signup that succeeded immediately before an assertion failed.
  try {
    const signupUser = await ownSignupUser();
    if (signupUser && !created.includes(signupUser.id)) created.push(signupUser.id);
  } catch {
    cleanupErrors.push("Could not locate the exact local signup account for cleanup");
  }
  for (const id of capturedMessages) {
    try {
      assert.ok(typeof id === "string" && id.length > 0);
      const result = await localFetch(`${mailpit}/api/v1/messages`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ IDs: [id] }),
      });
      assert.equal(result.status, 200);
    } catch {
      cleanupErrors.push("Could not remove an exact captured local test message");
    }
  }
  for (const id of created) {
    try {
      const result = await admin.auth.admin.deleteUser(id);
      assert.ok(!result.error);
    } catch {
      cleanupErrors.push("Could not remove an exact local test account");
    }
  }
  assert.equal(cleanupErrors.length, 0, cleanupErrors.join("; "));
}
