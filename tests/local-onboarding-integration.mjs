import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import nextEnv from "@next/env";

// Local captured-mail test only. Never log keys, sessions, messages or OTP values.
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
  throw new Error("Isolated local Supabase status is unavailable");
}
assert.equal(status.API_URL, "http://127.0.0.1:55321", "Expected isolated local API");
const base = "http://127.0.0.1:3000",
  mailpit = "http://127.0.0.1:55324";
const env = nextEnv.loadEnvConfig(process.cwd(), true, { info() {}, error() {} }).combinedEnv;
assert.equal(
  env.NEXT_PUBLIC_SUPABASE_URL,
  status.API_URL,
  "The app must use the same local backend",
);
assert.ok(
  !env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY === status.PUBLISHABLE_KEY,
  "Unexpected public-key override",
);
const options = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
};
const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, options),
  guest = createClient(status.API_URL, status.ANON_KEY, options);
const created = new Set(),
  messages = new Set();
const email = `onboarding-${randomBytes(10).toString("hex")}@aiverse.test`;
const password = randomBytes(24).toString("base64url");
let ownerId;
async function localFetch(url, options = {}) {
  const target = new URL(url);
  assert.ok(
    [base, mailpit, status.API_URL].includes(target.origin) && !target.username && !target.password,
    "Requests must stay within the isolated loopback services",
  );
  try {
    return await fetch(target, {
      ...options,
      redirect: "manual",
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new Error("An isolated local onboarding request failed or timed out");
  }
}
function browser() {
  const jar = new Map();
  return async (path, body) => {
    const target = new URL(path, base);
    assert.equal(target.origin, base, "Session cookies stay on the local app");
    const response = await localFetch(target, {
      method: body ? "POST" : "GET",
      headers: {
        origin: base,
        "content-type": "application/json",
        cookie: [...jar].map(([key, value]) => `${key}=${value}`).join("; "),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";", 1)[0],
        equal = pair.indexOf("=");
      if (/max-age=0/i.test(cookie)) jar.delete(pair.slice(0, equal));
      else jar.set(pair.slice(0, equal), pair.slice(equal + 1));
    }
    return response;
  };
}
async function findOwner() {
  for (let page = 1; page <= 10; page++) {
    const result = await admin.auth.admin.listUsers({ page, perPage: 100 });
    assert.ok(!result.error, "Could not inspect the exact temporary signup for cleanup");
    const user = result.data.users.find((user) => user.email === email);
    if (user) return user;
    if (result.data.users.length < 100) return null;
  }
  throw new Error("Bounded local account cleanup lookup exceeded its limit");
}
async function capturedCode(previousMessages = new Set()) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const response = await localFetch(`${mailpit}/api/v1/messages?limit=200`);
    assert.equal(response.status, 200);
    const listing = await response.json();
    const matching = listing.messages.filter((message) =>
      message.To?.some((recipient) => recipient.Address === email),
    );
    for (const message of matching) {
      assert.match(message.ID, /^[A-Za-z0-9_-]+$/);
      messages.add(message.ID);
    }
    const fresh = matching.filter((message) => !previousMessages.has(message.ID));
    if (fresh.length) {
      assert.equal(fresh.length, 1, "One new message belongs to the unique local test recipient");
      const message = await localFetch(`${mailpit}/api/v1/message/${fresh[0].ID}`);
      assert.equal(message.status, 200);
      const full = await message.json();
      assert.ok(
        full.To?.some((recipient) => recipient.Address === email),
        "Only the exact test recipient may be read",
      );
      const code = String(full.HTML ?? "").match(/<strong>\s*(\d{6})\s*<\/strong>/i)?.[1];
      assert.ok(
        code && /^\d{6}$/.test(code),
        "Expected a six-digit code in the configured local template",
      );
      return code;
    }
    await delay(250);
  }
  throw new Error("No local verification code was captured within ten seconds");
}
function checked(result, message) {
  assert.ok(!result.error, message);
  return result.data;
}
const account = {
  fullName: "Private integration name",
  age: 25,
  contactNumber: "+1 555 123 4567",
  preferences: {
    status: "completed",
    genres: ["fantasy", "sci-fi", "comedy", "horror", "animals"],
    regions: ["korean"],
  },
  ethnicity: "Optional test-only self-description",
  ethnicityConsent: true,
};
let failure;
try {
  const owner = browser();
  const signup = await owner("/api/auth", { action: "signup", email, password });
  assert.equal(signup.status, 200, "Local email signup");
  assert.deepEqual(await signup.json(), { ok: true, confirmationRequired: true });
  const owned = await findOwner();
  assert.ok(owned, "Exact signup account exists for cleanup");
  ownerId = owned.id;
  created.add(ownerId);
  assert.ok(!owned.email_confirmed_at, "Signup must not auto-confirm");
  assert.equal(
    (await owner("/api/me/onboarding")).status,
    401,
    "No session before code verification",
  );
  assert.equal(
    (await owner("/api/me/onboarding", account)).status,
    401,
    "No private save before verification",
  );
  assert.equal(
    (await owner("/api/auth", { action: "login", email, password })).status,
    400,
    "Password alone cannot bypass verification",
  );
  const initialCode = await capturedCode();
  const wrong = initialCode === "000000" ? "111111" : "000000";
  assert.equal(
    (await owner("/api/auth", { action: "verify_signup", email, code: wrong })).status,
    400,
    "Wrong code denied",
  );
  assert.equal((await owner("/api/me/onboarding")).status, 401, "Wrong code creates no session");
  // Fixture-only expiry simulation: change no token or account outside this exact
  // newly created, still-unconfirmed UUID in the isolated database container.
  assert.match(ownerId, /^[0-9a-f-]{36}$/i);
  try {
    execFileSync(
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
        input: `update auth.users set confirmation_sent_at=now()-interval '2 hours' where id='${ownerId}'::uuid and email_confirmed_at is null;`,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
  } catch {
    throw new Error("Could not expire the exact owned local verification challenge");
  }
  assert.equal(
    (await owner("/api/auth", { action: "verify_signup", email, code: initialCode })).status,
    400,
    "An expired captured code creates no session",
  );
  assert.equal(
    (await owner("/api/me/onboarding")).status,
    401,
    "Expired verification leaves the account unauthenticated",
  );
  const priorMessages = new Set(messages);
  await delay(1200); // Respect the isolated Auth service's configured one-second cooldown.
  assert.equal(
    (await owner("/api/auth", { action: "resend_signup", email })).status,
    200,
    "Actual local resend recovers the signup challenge",
  );
  const code = await capturedCode(priorMessages);
  assert.ok(code !== initialCode, "Resend issues a replacement code");
  assert.equal(
    (await owner("/api/auth", { action: "verify_signup", email, code: initialCode })).status,
    400,
    "Superseded code cannot establish a session",
  );
  assert.equal(
    (await owner("/api/me/onboarding")).status,
    401,
    "A superseded code creates no session",
  );
  const verified = await owner("/api/auth", { action: "verify_signup", email, code });
  assert.equal(verified.status, 200, "Actual captured code establishes session cookies");
  assert.equal((await verified.json()).next, "/onboarding");
  const replaySession = browser();
  assert.equal(
    (await replaySession("/api/auth", { action: "verify_signup", email, code })).status,
    400,
    "Used code cannot establish a second session",
  );
  assert.equal((await replaySession("/api/me/onboarding")).status, 401);
  const incomplete = await owner("/api/me/onboarding");
  assert.equal(incomplete.status, 200);
  assert.equal((await incomplete.json()).profile, null);
  assert.equal(
    (await owner("/api/me/onboarding", { ...account, ethnicityConsent: false })).status,
    400,
    "Consent bypass denied",
  );
  assert.equal(
    (await owner("/api/me/onboarding", account)).status,
    200,
    "Atomic private onboarding save",
  );
  const saved = await owner("/api/me/onboarding");
  assert.equal(saved.status, 200);
  assert.equal(saved.headers.get("cache-control"), "private, no-store");
  const savedData = await saved.json();
  assert.equal(savedData.next, "/dashboard");
  assert.deepEqual(savedData.preferences, account.preferences);
  for (const key of ["fullName", "age", "contactNumber", "ethnicity", "ethnicityConsent"])
    assert.deepEqual(
      savedData.profile[key],
      account[key],
      "Private field persists only for its owner",
    );

  const secondEmail = `onboarding-other-${randomBytes(10).toString("hex")}@aiverse.test`;
  const second = checked(
    await admin.auth.admin.createUser({ email: secondEmail, password, email_confirm: true }),
    "Create exact second local privacy fixture",
  ).user;
  created.add(second.id);
  const other = browser();
  assert.equal(
    (await other("/api/auth", { action: "login", email: secondEmail, password })).status,
    200,
  );
  const otherRead = await other(`/api/me/onboarding?user_id=${ownerId}`);
  assert.equal(otherRead.status, 200);
  assert.equal(
    (await otherRead.json()).profile,
    null,
    "A query argument cannot select another account",
  );
  const ownerClient = createClient(status.API_URL, status.ANON_KEY, options),
    otherClient = createClient(status.API_URL, status.ANON_KEY, options);
  checked(await ownerClient.auth.signInWithPassword({ email, password }), "Owner database session");
  checked(
    await otherClient.auth.signInWithPassword({ email: secondEmail, password }),
    "Second-account database session",
  );
  assert.deepEqual(
    checked(
      await otherClient.from("account_details").select("*").eq("user_id", ownerId),
      "Cross-account private read denied",
    ),
    [],
  );
  assert.equal(
    (
      await otherClient.rpc("complete_account_onboarding", {
        payload: { ...account, user_id: ownerId },
      })
    ).error?.code,
    "22023",
    "Owner injection denied in SQL",
  );
  assert.equal(
    (await guest.from("account_details").select("*")).error?.code,
    "42501",
    "Anonymous private table access denied",
  );
  assert.equal(
    (await guest.rpc("complete_account_onboarding", { payload: account })).error?.code,
    "42501",
    "Anonymous completion denied",
  );
  const baseline = checked(
    await ownerClient.from("profiles").select("display_name").eq("id", ownerId),
    "Existing display name remains separate",
  );
  assert.equal(
    baseline[0].display_name,
    "",
    "Private full name never copied to existing profile/public identity",
  );
  const projection = checked(
    await guest.from("public_creators").select("*").eq("id", ownerId),
    "Public creator projection remains private-data-free",
  );
  assert.deepEqual(projection, []);
  const publicText = JSON.stringify(projection);
  for (const value of [
    account.fullName,
    account.contactNumber,
    account.ethnicity,
    "ethnicity",
    "age",
    "contact_number",
    "full_name",
  ])
    assert.ok(!publicText.includes(value), "No private profile field in public output");
  assert.equal(
    (
      await ownerClient.rpc("complete_account_onboarding", {
        payload: {
          ...account,
          fullName: "Attempted partial change",
          preferences: {
            ...account.preferences,
            genres: ["unknown", "sci-fi", "comedy", "horror", "animals"],
          },
        },
      })
    ).error?.code,
    "22023",
    "Invalid interests roll back the entire transaction",
  );
  assert.equal(
    (await (await owner("/api/me/onboarding")).json()).profile.fullName,
    account.fullName,
  );
  assert.equal((await owner("/api/auth", { action: "logout" })).status, 200);
  assert.equal((await owner("/api/me/onboarding")).status, 401);
  const returning = await owner("/api/auth", { action: "login", email, password });
  assert.equal(returning.status, 200);
  assert.equal(
    (await returning.json()).next,
    "/dashboard",
    "Returning account skips completed onboarding",
  );
  assert.equal(
    (
      await owner("/api/me/onboarding", {
        ...account,
        contactNumber: null,
        ethnicity: null,
        ethnicityConsent: false,
      })
    ).status,
    200,
    "Owner can remove optional contact and revoke ethnicity consent",
  );
  const revokedProfile = (await (await owner("/api/me/onboarding")).json()).profile;
  assert.equal(revokedProfile.ethnicity, null);
  assert.equal(revokedProfile.ethnicityConsent, false);
  assert.equal(revokedProfile.contactNumber, null);
  const consent = checked(
    await ownerClient
      .from("account_details")
      .select("ethnicity,ethnicity_consented_at")
      .eq("user_id", ownerId),
    "Consent removal persisted",
  );
  assert.deepEqual(consent, [{ ethnicity: null, ethnicity_consented_at: null }]);
  assert.equal(
    (await browser()("/api/auth/google")).status,
    503,
    "Local Google remains honestly unconfigured",
  );
  await owner("/api/auth", { action: "logout" });
  await other("/api/auth", { action: "logout" });
} catch (error) {
  failure = error;
} finally {
  const cleanupErrors = [];
  try {
    if (!ownerId) {
      const owned = await findOwner();
      if (owned) created.add(owned.id);
    }
  } catch {
    cleanupErrors.push("exact signup lookup");
  }
  // Also collect mail created just before an earlier assertion failed.
  try {
    const response = await localFetch(`${mailpit}/api/v1/messages?limit=200`);
    assert.equal(response.status, 200);
    const listing = await response.json();
    for (const message of listing.messages) {
      if (message.To?.some((recipient) => recipient.Address === email)) {
        assert.match(message.ID, /^[A-Za-z0-9_-]+$/);
        messages.add(message.ID);
      }
    }
  } catch {
    cleanupErrors.push("exact captured mail lookup");
  }
  for (const id of created) {
    try {
      assert.match(id, /^[0-9a-f-]{36}$/i);
      checked(await admin.auth.admin.deleteUser(id), "Remove exact temporary onboarding account");
    } catch {
      cleanupErrors.push("exact local account removal");
    }
  }
  for (const id of messages) {
    try {
      const response = await localFetch(`${mailpit}/api/v1/messages`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ IDs: [id] }),
      });
      assert.equal(response.status, 200, "Remove only captured test mail");
    } catch {
      cleanupErrors.push("exact captured mail removal");
    }
  }
  if (cleanupErrors.length) {
    failure = failure ?? new Error("Exact local fixture cleanup was incomplete");
    console.error(
      "Local onboarding cleanup needs inspection of exact onboarding-* fixtures; no broad reset was attempted.",
    );
  }
}
if (failure) {
  console.error(
    `FAIL: ${failure instanceof Error ? failure.message : "local onboarding integration failed"}`,
  );
  process.exitCode = 1;
} else {
  console.log(
    "PASS: local captured-code signup, wrong/expired/superseded/replayed-code denial, resend recovery, verified cookies, atomic private onboarding, returning dashboard login, owner isolation and consent removal; exact fixture cleanup completed. Expiry was simulated only on the owned local fixture. No hosted project or external email was used.",
  );
}
