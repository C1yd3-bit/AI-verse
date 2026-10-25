import { pathToFileURL } from "node:url";
import { stat } from "node:fs/promises";
import { extname, resolve } from "node:path";
import nextEnv from "@next/env";

/** Reports prerequisites only. It never uploads, enables features or prints credentials. */
export function mediaReadiness(env) {
  let localDatabase = false;
  try {
    const url = new URL(env.NEXT_PUBLIC_SUPABASE_URL);
    localDatabase = url.origin === "http://127.0.0.1:55321";
  } catch {
    /* Missing configuration is a failed check, not an exception. */
  }
  const configured = (value) => typeof value === "string" && value.trim().length >= 20;
  const checks = [
    {
      id: "local-supabase",
      ready: localDatabase,
      action: "Keep the dedicated local aiverse-ana project active.",
    },
    {
      id: "public-supabase-key",
      ready: configured(
        env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      ),
      action: "Configure the public local Supabase key in the ignored local environment.",
    },
    {
      id: "server-supabase-key",
      ready: configured(env.SUPABASE_SERVICE_ROLE_KEY),
      action: "Configure the server-only local Supabase service key.",
    },
    {
      id: "stream-account",
      ready: /^[a-f0-9]{32}$/.test(env.CLOUDFLARE_ACCOUNT_ID ?? ""),
      action: "Configure the authorized Cloudflare account ID.",
    },
    {
      id: "stream-token",
      ready: /^[A-Za-z0-9_-]{20,256}$/.test(env.CLOUDFLARE_STREAM_API_TOKEN ?? ""),
      action: "Store an approved Stream API token server-side; never paste it into chat.",
    },
    {
      id: "uploads-enabled",
      ready: env.AIVERSE_ENABLE_STREAM_UPLOADS === "true",
      action: "Enable uploads only after rights, credentials and spending are approved.",
    },
    {
      id: "maintenance-worker",
      ready: configured(env.AIVERSE_WORKER_SECRET) && env.AIVERSE_WORKER_SECRET.trim().length >= 32,
      action:
        "Configure a server-only maintenance secret; invoke the authenticated worker to reconcile processing locally.",
    },
    {
      id: "published-catalog",
      ready: true,
      action:
        "The application reads only the published database catalog; it has no sample-data fallback.",
    },
  ];
  return {
    kind: "Local configuration preflight; not a live-service verification",
    ready: checks.every((c) => c.ready),
    checks,
    externalChecks: [
      "Cloudflare Stream entitlement and approved test costs",
      "Rights-cleared MP4/MOV up to500MB; Movies up to1200seconds, Reels up to180seconds",
      "Authorized creator and separate reviewer",
      "Actual upload, processing, private review, publication and playback",
      "Configured HTTPS webhook or deliberate authenticated maintenance reconciliation",
      "Cleanup and provider removal verification",
    ],
  };
}

export async function mediaFileReadiness(file, rightsConfirmed) {
  if (!file)
    return {
      provided: false,
      ready: false,
      reason: "A rights-cleared test video path has not been supplied.",
    };
  if (!rightsConfirmed)
    return {
      provided: true,
      ready: false,
      reason: "Explicit permission to upload/distribute this file is required.",
    };
  if (![".mp4", ".mov"].includes(extname(file).toLowerCase()))
    return { provided: true, ready: false, reason: "Use an MP4 or MOV file." };
  try {
    const info = await stat(file);
    if (!info.isFile() || info.size < 1 || info.size > 500_000_000)
      return { provided: true, ready: false, reason: "Use a nonempty file up to500MB." };
    return {
      provided: true,
      ready: true,
      bytes: info.size,
      reason:
        "File size/extension and explicit rights confirmed; actual decode/duration still require verification. Files over200MB use TUS.",
    };
  } catch {
    return { provided: true, ready: false, reason: "The supplied local test file is unavailable." };
  }
}

async function main() {
  const args = process.argv.slice(2);
  let file;
  let rights = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--video" && args[i + 1] && !args[i + 1].startsWith("--")) file = args[++i];
    else if (args[i] === "--rights-confirmed") rights = true;
    else
      throw new Error(
        "Use media:preflight [--video <local-path> --rights-confirmed]. This command never uploads.",
      );
  }
  nextEnv.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
  const report = mediaReadiness(process.env);
  report.file = await mediaFileReadiness(file, rights);
  report.ready = report.ready && report.file.ready;
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.ready ? 0 : 2;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  main().catch(() => {
    console.error(
      "Media preflight failed. No configuration values, paths or credentials were logged; no service changes were made.",
    );
    process.exitCode = 1;
  });
