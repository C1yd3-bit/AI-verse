# Local development

[[Home]] · [[04 Operations/Runbook|Runbook]] · [[03 Delivery/Release Checklist|Release checklist]]

## Project and Obsidian

Project root: `<project-root>`.

Choose Obsidian **Open folder as vault**, then `<project-root>\docs\vault`. Open Home. Built-in plugins only; this does not install Obsidian.

## Application

Use Node 24.x and npm, open PowerShell in the project root:

```powershell
npm ci
if (-not (Test-Path .env.local)) { Copy-Item .env.example .env.local }
npm run dev
```

Use the printed loopback origin, normally `http://127.0.0.1:3000`. This workspace currently has an ignored local account environment; never copy over a configured local file. Runtime catalog reads always use published database records, with honest empty/unavailable states and no demo fallback. Restart Next.js after environment edits. Keep local auth callback URLs consistent with the origin.

## Isolated local Supabase

Local Supabase remains the development database/backend. Continue using project `aiverse-ana` and the active ignored `.env.local`; its API URL is exactly `http://127.0.0.1:55321`, with local keys. The current local file has no publishable-key override. Deterministic catalog fixtures are test-only.

The user separately authorized the completed hosted schema/taxonomy push; see [[03 Delivery/Hosted Supabase Migration Verification]]. The CLI is now linked to that hosted project, so use explicit `--local` for supported local migration/query commands, including `supabase migration up --local`; do not use an unqualified linked push for local work. The ignored `.env.hosted.local` profile remains staged and inactive. Hosted runtime activation and service configuration remain separate from local development. See [[04 Operations/Hosted Environment]] and [[02 Architecture/Decisions#ADR-015 — Local Supabase for now]].

Requires Docker and Supabase CLI. Configuration uses project `aiverse-ana`, API `127.0.0.1:55321`, PostgreSQL 55322, shadow DB 55320 and captured-mail UI 55324. The dedicated Docker network requests a loopback default, but that option does not prove the actual host bindings. Latest inspection advertises wildcard Docker bindings; host-only exposure is not certified. First inspect whether the network exists; create it only if absent:

```powershell
docker network inspect aiverse-ana-local
# Only if absent:
docker network create --driver bridge --opt com.docker.network.bridge.host_binding_ipv4=127.0.0.1 aiverse-ana-local
supabase start --network-id aiverse-ana-local -x realtime,imgproxy,studio,postgres-meta,logflare,vector,supavisor
```

Do not capture/print the CLI credential summary into chat, logs or this vault. Verify container port bindings locally. Apply ordered migrations without resetting data using the CLI's local migration procedure (`supabase migration up --local`). Read `supabase/README.md` before schema or role changes; do not use a database reset on existing data.

The active Storage upload path requires both `storage-api` and `edge-runtime`; do not exclude them as the historical local command did. The data-preserving CLI2.122 restart and local018–020 application are complete. Actual local generated-file signed upload/private native playback passed, followed by exact synthetic cleanup with original account/content preserved. For future restarts, retain volumes/accounts rather than resetting. Serve `media-storage` with its intended local configuration and verify the Storage/Edge services before testing bytes. Hosted migrations/Edge v1 are also installed, but hosted actual-binary/authenticated browser journeys and Git/Vercel application publication remain pending. See [[03 Delivery/Storage Upload Verification]].

`supabase/config.toml` keeps email confirmation enabled. Test messages are captured locally at `http://127.0.0.1:55324`; no external SMTP delivery is proved. Auth accepts the `/auth/callback` routes for localhost/127.0.0.1:3000. The local HTTP integration now exercises normal signup, captured Mailpit confirmation and PKCE callback cookie exchange through onboarding/preferences and logout, alongside isolated temporary confirmed users for other checks.

Local project credentials are stored in ignored `.env.local`. For a new machine, obtain that machine's local values privately from the CLI and enter them directly in the file. Preserve existing database data when restarting the stack; do not reset it or remove its volumes. Future hosted use requires a separate activation decision and verification, while this local setup remains the development target. No admin is seeded: bootstrap a verified Auth UUID via a trusted owner connection and restricted audit, as documented in `supabase/README.md`.

## Configuration contract

- Account preferences use verified authenticated APIs; legacy app-mode values do not enable browser-only mock preferences.
- `NEXT_PUBLIC_APP_URL`: exact app origin.
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`: public project configuration; the adapter also accepts `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
- The active `media-storage` Edge Function uses Supabase's built-in server-only service key; never expose it to browsers or add it as a privileged Vercel variable for this path. Local function and Next.js environments are separate runtimes. [Supabase Edge variables](https://supabase.com/docs/guides/functions/secrets)
- Runtime discovery always uses the published database projection. Legacy `AIVERSE_CATALOG_MODE` values cannot restore fixtures; a successful empty catalog remains empty, and unavailable services show explicit recovery states.
- `AIVERSE_ENABLE_STREAM_UPLOADS=false` and Cloudflare credential placeholders belong to dormant legacy adapters; they are not prerequisites for active Supabase Storage uploads.
- `AIVERSE_WORKER_SECRET` and `AIVERSE_RETENTION_DAYS` belong to the historical internal Stream/retention worker. Do not infer a Storage cleanup schedule from their presence.

Enter secrets only in the ignored local file or approved hosting secret store. `NEXT_PUBLIC_` values may be bundled for browsers. Keep external uploads disabled while running local integration tests.

The user explicitly removed Cloudflare from the active path. Keep legacy Stream unconfigured; do not create credentials or activate billing. Active Storage accepts MP4/H.264 up to50,000,000bytes, not the dormant500MB/TUS policy. Owners still need rights/AI attestation, quotas and human publication review. Storage cleanup runs opportunistically in service-only batches up to three after the two-hour upload capability plus safety margin; no automatic cron exists. No runtime/hosted acceptance is implied by local configuration alone. [Supabase limits](https://supabase.com/docs/guides/storage/uploads/file-limits)

## Verification layers

```powershell
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
```

With local Supabase and an account-mode app at `127.0.0.1:3000`:

```powershell
npm run test:integration
npm run test:onboarding
node tests/local-media-integration.mjs
npm run smoke
```

The HTTP integration scripts are local-only and refuse the wrong API origin. They create randomized temporary accounts and clean up only their owned records/messages. Account checks include real Mailpit confirmation/PKCE, preferences/logout, owner-isolated library save/delete and actual studio/report/appeal HTTP column queries. The media script races four real PostgREST reservation requests, expecting three accepted/one denied, and checks version/publication/replay/removal boundaries using simulated provider facts. It passes after the fair-processing migration; it performs no Cloudflare binary upload or deletion. Review a cleanup warning before rerunning; do not delete unrelated accounts or reset the database.

Apply every ordered migration, including 005 RPC/binding/text hardening, 006 public creators, 007 fair processing/terminal deletion and 008 duration-derived playback windows. Exact final totals/check outcomes belong to the parent/reviewer evidence. The earlier privileged browser gate was resolved by explicit human approval limited to two disposable personas on isolated `aiverse-ana`; creator/candidate/administrator workflows were exercised and all exact accounts/dependent records and temporary credentials removed afterward. Fourteen valid desktop/mobile captures received independent finish review with no material visual blocker in observed states. Moderator-only browser and actual player coverage remain unverified. See [[03 Delivery/Authenticated Browser Verification]].

The parent checked only configuration flags: local Supabase URL remains exactly `http://127.0.0.1:55321`, uploads remain false and Cloudflare account/token values remain empty. This does not configure hosted services or authorize future production personas. Processing evidence in browser review was explicitly simulated at ninety seconds; private preview correctly reported unconfigured playback, and no video was published.

PGlite provides meaningful SQL/RLS tests with emulated Auth; local integration adds actual local Auth and PostgREST. Choosing local Supabase does not itself establish a new migration, persistence or integration test result; current evidence belongs in [[03 Delivery/Verification]] and the Build Log. Hosted email/cookies, Cloudflare, real licensed playback and deployment need separate evidence when those stages are authorized. CI currently runs the portable Node/PGlite suite, not Docker integrations. See [[03 Delivery/Release Checklist]] for open gates.

## Current account/OTP extension

Migrations 009/010 were applied only to isolated local `aiverse-ana` through transactional container SQL plus migration history, preserving the existing volume. Two local service restarts loaded the custom code-only confirmation template; email contains six digits without a fallback confirmation link. Keep credentials/mail codes out of terminal output and chat. Google provider readiness is false; external Google credentials/setup and real OAuth remain pending.

`npm run test:onboarding` exercises real Mailpit OTP signup, wrong/fixture-timestamp-expired/resend/superseded/replayed-code cases, private profile/preferences, verified-owner denial, rollback and consent clearing. The updated existing account integration also passes; earlier confirmation-link documentation is historical, not the current signup contract. Both tests clean their exact fixtures. Current parent checks pass 153 tests/19 files, typecheck/lint/format, 36-page build and 28 HTTP smokes.

Observed mobile390/desktop1505 account browser journey passes through verification, private information, interests, optional ethnicity skip, awaited save/dashboard, edit/reload and logout. Two exact disposable accounts (journey and fresh unconfirmed label recaptures), private profiles/messages and temporary credentials were removed. Fourteen valid account captures were reviewed. Keyboard/reduced-motion mechanisms were inspected in source; exhaustive runtime coverage is not claimed. Independent backend verdict is ACCEPT; formal design disposition remains FIX for static-plate/method persistence, with no remaining material UI repair. See [[02 Architecture/Account Onboarding]], [[03 Delivery/Auth Onboarding Verification]] and [[03 Delivery/Auth Onboarding Design Review]]. Existing release and privacy/service gates remain open.
