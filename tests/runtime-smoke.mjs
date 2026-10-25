import assert from "node:assert/strict";

// Read-only checks against the current app. Accept explicit catalog unavailability;
// never create records, require seeded examples or treat a service error as empty.
const origin = "http://127.0.0.1:3000";
const results = [];
const sampleIds = [
  "somewhere-after-midnight",
  "last-greenhouse",
  "one-table-for-two",
  "tides-of-tomorrow",
  "unreviewed-demo",
];
const sampleTitles = [
  "Somewhere, after midnight",
  "The last greenhouse",
  "One table for two",
  "Tides of tomorrow",
  "Private processing example",
];
async function check(path, status, text) {
  const response = await fetch(`${origin}${path}`, {
    redirect: "manual",
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  assert.ok(
    (Array.isArray(status) ? status : [status]).includes(response.status),
    `${path}: HTTP ${response.status}, expected ${status}`,
  );
  const body = await response.text();
  if (text) assert.ok(body.includes(text), `${path}: missing expected response content`);
  results.push({ path, status: response.status });
  return { response, body };
}
function noSamples(body, path) {
  for (const title of sampleTitles)
    assert.ok(!body.includes(title), `${path}: retired fixture title remains`);
  assert.ok(
    !/\/artwork\/(?:midnight|greenhouse|cat|tides)-v2\.png/.test(body),
    `${path}: retired artwork remains`,
  );
}
const catalog = await check("/api/catalog?limit=20", [200, 503]);
const published = JSON.parse(catalog.body);
if (catalog.response.status === 200) {
  assert.equal(published.mode, "live");
  for (const item of [...published.exact.items, ...published.broader.items]) {
    assert.match(item.id, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i);
    assert.equal(item.status, "published");
    assert.equal(item.demo, false);
    assert.ok(!sampleIds.includes(item.id));
  }
} else {
  assert.equal(published.error, "Catalog unavailable. Try again later.");
  assert.ok(!("exact" in published), "Unavailable catalog must not masquerade as empty");
}
const home = await check(
  "/",
  200,
  catalog.response.status === 503 ? "The catalog is unavailable." : "Your next world is waiting.",
);
noSamples(home.body, "/");
if (catalog.response.status === 200 && published.exact.total === 0)
  assert.ok(
    home.body.includes("No films have been published yet."),
    "Empty DB requires an honest Home state",
  );
for (const [path, heading] of [
  ["/reels", "Small stories"],
  ["/movies", "Stay a little longer"],
  ["/search?q=cat%20cooking%20spaghetti", "Results for"],
  ["/fusion?region=all&genre=all&format=all", "Your taste"],
]) {
  const page = await check(path, 200);
  assert.ok(
    page.body.includes(heading) || page.body.includes("The catalog is unavailable."),
    `${path}: missing public or unavailable state`,
  );
  noSamples(page.body, path);
}
for (const path of ["/login", "/signup"]) {
  const page = await check(path, 200);
  noSamples(page.body, path);
}
for (const path of ["/onboarding", "/profile"]) {
  const page = await check(path, [200, 307]);
  assert.ok(
    page.response.status === 307
      ? page.response.headers.get("location") === "/login"
      : page.body.includes("NEXT_REDIRECT;replace;/login;307;"),
    "Guest account pages must redirect to login",
  );
  assert.ok(!page.body.includes("Private account details"), "Private account content leaked");
}
const dashboard = await check("/dashboard", [200, 307]);
assert.ok(
  dashboard.response.status === 307
    ? dashboard.response.headers.get("location") === "/profile"
    : dashboard.body.includes("NEXT_REDIRECT;replace;/profile;307;"),
);
for (const path of [
  "/watch/somewhere-after-midnight",
  "/watch/unreviewed-demo",
  "/reels/one-table-for-two",
]) {
  const page = await check(path, [200, 404]);
  assert.ok(page.body.includes("noindex"), `${path}: retired record must be not found`);
  noSamples(page.body, path);
}
await check("/api/auth/providers", [200, 503], "googleAvailable");
for (const path of [
  "/api/me/onboarding",
  "/api/me/profile",
  "/api/me/preferences",
  "/api/studio",
  "/api/moderation",
  "/api/operations",
  "/api/reports",
  "/api/me/library",
  "/api/me/appeals",
])
  await check(path, [401, 503]);
for (const path of ["/settings/interests", "/studio", "/moderation", "/operations", "/library"])
  await check(path, 200);
const invalid = await check("/api/catalog?limit=invalid", 400);
assert.ok(JSON.parse(invalid.body).error);
console.log(
  JSON.stringify(
    {
      result: "PASS",
      scope:
        "Read-only published catalog/empty or unavailable pages, retired fixture permalinks and guest authorization; no provider, browser or upload verification",
      catalog: catalog.response.status === 200 ? "published" : "unavailable",
      checks: results,
    },
    null,
    2,
  ),
);
