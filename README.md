# AIVerse

An AI-created entertainment MVP built with Next.js App Router, TypeScript, React, Supabase Auth/Postgres/RLS and Cloudflare Stream.

The app shows **real published database content only**. An empty catalog stays empty; missing database configuration shows an unavailable state. Sample film records are isolated under `tests/fixtures` and never imported by the application. Sample movie artwork, account databases, downloaded videos and credentials are excluded from this repository.

## Local setup

Use Node.js 24 and npm. Clone this repository, then run:

```sh
npm ci
cp .env.example .env.local
npm run dev
```

On PowerShell, use `Copy-Item .env.example .env.local` only if the local file does not exist, and `npm.cmd` if script execution blocks `npm.ps1`. Preserve an existing local environment. The development server binds to loopback at `http://127.0.0.1:3000`.

The dedicated local Supabase project is `aiverse-ana`: API 55321, database 55322 and captured mail 55324. Follow [supabase/README.md](supabase/README.md) to start it and apply every ordered migration without resetting an existing database. Configure the public URL/key and server-only service key in ignored `.env.local`. Keep secrets out of chat, source, screenshots and logs.

Without Supabase configuration the site shows unavailable states, without fabricating accounts or media. Seed SQL inserts taxonomy only, never sample users, films or activity. Hosted environments require their own authorized setup; this repository does not activate a hosted project.

## Features

- Published-only movie/reel discovery, filters, Fusion and a catalog-grounded rule-based assistant.
- Email signup with verification code, private onboarding, account details, avatar, interests and light/dark appearance. Google requires a configured OAuth provider.
- Approved creator applications, immutable private film revisions and optional thumbnails. Moderators review each exact revision; administrators alone grant creator roles.
- Movies up to 20 minutes/500 MB; Reels up to three minutes. Files through 200 MB use multipart; larger files use private TUS chunks, measured progress and cancellation with conservative uncertainty recovery.
- Signed explicit playback, one active player, owner/version-bound retained completion signals, likes, follows, saved mixes and reports. Completion signals are not public view counts.
- Suspension, appeals, quotas, takedown, reconciliation/deletion workers and bounded retention mechanisms.

Auth uses real published covers when available and a quiet empty state otherwise. Old sample film URLs return not found. User data stays in Supabase; test records are not application content.

## Video services

Stream uploads remain disabled until approved credentials, rights and costs are configured. Set server-only Cloudflare account/token and maintenance secrets locally. Never expose secrets through `NEXT_PUBLIC_` values. The GitHub connection does not configure delivery, hosting or billing.

```sh
npm run media:preflight
```

This read-only command reports prerequisites without printing credentials or making provider changes. Optional file checks use `-- --video <local-path> --rights-confirmed`; they check size/extension/explicit permission, not full decode or live service behavior.

Default quotas remain three uploads/day and 30 minutes/month. Process/reconcile one long film before reserving the next so unused holds are released. Actual processing requires verified webhooks or authenticated maintenance; Studio Refresh only rereads database state.

Movie playback windows use verified duration plus 60 seconds, capped at 21 minutes; Reels retain a five-minute ceiling. Hiding denies new grants, while existing tokens/cache may remain valid. Actual delivery, CORS, revocation, deletion and operational policies require live verification. Source publication does not deploy the app.

## Checks

```sh
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
```

`npm run smoke` checks a running local preview. Local Auth/media/onboarding integrations need isolated services and disposable fixtures. Unit tests use deterministic fixtures and PGlite with emulated Auth; controlled provider responses do not establish real Cloudflare operation.

GitHub Actions runs lockfile installation and these checks on Node 24 with read-only permissions, no project secrets and no deployment. Current evidence and limitations live in [STATE.md](STATE.md) and the [vault roadmap](docs/vault/03%20Delivery/Roadmap.md).

## Documentation and agents

Open `docs/vault` as an Obsidian vault and start at [Home](docs/vault/Home.md). Historical source/design notes record earlier decisions, including retired demo content; they do not enable runtime fixtures. Private evidence images and machine state are intentionally excluded from Git.

[AGENTS.md](AGENTS.md), [LOOP.md](LOOP.md), [PRODUCT.md](PRODUCT.md), DESIGN.md and surface briefs define implementation/review conventions. Agent roles are mirrored in `.cursor/agents` and `.agents/agents`. Hosting, service credentials, live delivery, rights/privacy/retention and overall release remain explicit gates in the [release checklist](docs/vault/03%20Delivery/Release%20Checklist.md).
