import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtemp, open, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mediaFileReadiness, mediaReadiness } from "../scripts/media-preflight.mjs";

describe("read-only media preflight", () => {
  it("accepts a330MB full-film file and rejects over500MB without reading or uploading the binary", async () => {
    const folder = await mkdtemp(join(tmpdir(), "aiverse-film-preflight-"));
    const file = join(folder, "permitted-film.mp4");
    try {
      const handle = await open(file, "w");
      try {
        await handle.truncate(329742172);
      } finally {
        await handle.close();
      }
      expect(await mediaFileReadiness(file, true)).toMatchObject({ ready: true, bytes: 329742172 });
      const larger = await open(file, "r+");
      try {
        await larger.truncate(500000001);
      } finally {
        await larger.close();
      }
      expect(await mediaFileReadiness(file, true)).toMatchObject({
        ready: false,
        reason: "Use a nonempty file up to500MB.",
      });
    } finally {
      await unlink(file).catch(() => undefined);
      await rmdir(folder);
    }
  });
  it("executes the real Node CLI and rejects invalid flags without dumping environment values", () => {
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL("../scripts/media-preflight.mjs", import.meta.url)), "--unknown"],
      {
        encoding: "utf8",
        env: { ...process.env, PRIVATE_TEST_SECRET: "must-not-appear-in-output" },
      },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("No configuration values");
    expect(result.stdout + result.stderr).not.toContain("must-not-appear-in-output");
    expect(result.stderr).not.toContain("SyntaxError");
  });
  it("reports missing live prerequisites without changing configuration or exposing values", () => {
    const env = Object.freeze({
      NEXT_PUBLIC_SUPABASE_URL: "https://private.example",
      CLOUDFLARE_STREAM_API_TOKEN: "secret-invalid!",
      AIVERSE_ENABLE_STREAM_UPLOADS: "false",
    });
    const result = mediaReadiness(env);
    expect(result.ready).toBe(false);
    expect(result.checks.find((c) => c.id === "local-supabase")?.ready).toBe(false);
    expect(JSON.stringify(result)).not.toContain("private.example");
    expect(JSON.stringify(result)).not.toContain("secret-invalid!");
  });
  it("requires explicit upload activation while catalog reads are always published-only", () => {
    const base = {
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55321",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "a".repeat(25),
      SUPABASE_SERVICE_ROLE_KEY: "b".repeat(25),
      CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
      CLOUDFLARE_STREAM_API_TOKEN: "c".repeat(40),
      AIVERSE_WORKER_SECRET: "d".repeat(32),
    };
    expect(
      mediaReadiness(base)
        .checks.filter((c) => !c.ready)
        .map((c) => c.id),
    ).toEqual(["uploads-enabled"]);
    const ready = mediaReadiness({
      ...base,
      AIVERSE_ENABLE_STREAM_UPLOADS: "true",
      AIVERSE_CATALOG_MODE: "live",
    });
    expect(ready.ready).toBe(true);
    expect(ready.kind).toContain("not a live-service verification");
    expect(ready.externalChecks).toContain("Cloudflare Stream entitlement and approved test costs");
  });
  it("requires explicit rights before inspecting a supplied file", async () => {
    expect(await mediaFileReadiness("C:/not-to-be-inspected/private.mp4", false)).toEqual({
      provided: true,
      ready: false,
      reason: "Explicit permission to upload/distribute this file is required.",
    });
    expect(await mediaFileReadiness(undefined, true)).toMatchObject({
      provided: false,
      ready: false,
    });
    expect(await mediaFileReadiness("image.png", true)).toMatchObject({
      ready: false,
      reason: "Use an MP4 or MOV file.",
    });
    const missing = await mediaFileReadiness("/never-exists-secret-name/test.mp4", true);
    expect(missing).toMatchObject({ ready: false });
    expect(JSON.stringify(missing)).not.toContain("secret-name");
  });
});
