# Hosted environment — staged and deferred

[[Home]] · [[04 Operations/Runbook|Runbook]] · [[04 Operations/Supabase Agent Setup|Supabase agent setup]] · [[04 Operations/Cloudflare Agent Setup|Cloudflare agent setup]]

## Current choice — local Supabase

The user explicitly chose to put the database in local Supabase for now. The active backend is the isolated `aiverse-ana` project at `http://127.0.0.1:55321`, using ignored `.env.local`. Continue development there. The hosted profile below remains ignored, staged and inactive; hosted prerequisites are deferred and do not block local development. No hosted schema, grants, Auth settings or other project resources may be changed as part of this local decision. See [[04 Operations/Local Development]] and [[02 Architecture/Decisions#ADR-015 — Local Supabase for now]].

## Supabase — retrieved and staged on 2026-10-24

The user authorized retrieving the environment credentials for project `YOUR_SUPABASE_PROJECT_REF`. The existing authenticated Supabase CLI retrieved that exact project's API keys without printing their values. The CLI's credential store was used normally; no Codex OAuth token was extracted or copied.

The ignored `.env.hosted.local` profile now contains the verified project URL, publishable/anon public keys, server-only service-role key and an internal worker secret. The app already supports `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Both legacy key roles were checked and their project claims matched. Requests to the exact project's Auth settings and service-authenticated REST schema endpoints returned HTTP 200.

`.env.hosted.local` is a staged profile, not a standard automatically loaded Next.js environment filename. The active `.env.local` was verified byte-for-byte unchanged, preserving the isolated local preview. Both filenames are excluded by `.gitignore`. The temporary raw-key retrieval file was removed after the profile was saved; no credential values appear in source, chat, this note or the safe result manifest.

## Deferred activation gate

The hosted REST schema metadata did not expose these required AIVerse relations: `public_catalog`, `public_creators`, `videos`, `video_versions`, `creator_applications`, and `saved_fusions`. This is evidence of missing API prerequisites, not proof that the entire hosted database is empty. No migrations, grants or project settings were changed.

This is a future hosted prerequisite, not current local work. If the user later authorizes hosted activation, first inspect that project's schema/migration history and Data API configuration, deliberately approve any schema changes, and verify Auth callbacks and permissions. Preserve the working local configuration throughout that process; do not automatically replace `.env.local` or activate the staged file on startup. Demo catalog mode and Stream uploads have separate acceptance gates.

## Cloudflare — left unconfigured at the user's request

Cloudflare's MCP connection is registered and authenticated, but its new tools are not exposed in the current chat. No connected Cloudflare plugin was found. The user completed dashboard sign-in. The Account ID was retrieved from the visible authenticated account URL and saved in the staged profile; it is not sufficient to configure Stream by itself.

The account-token page showed no existing account tokens. A draft named AIVerse Stream test was prepared with Stream Write access to that account and a thirty-day expiry of November 23, 2026. The user explicitly chose **Leave Cloudflare unconfigured** at the required action-time approval. The draft was discarded without clicking Create token. Stream API-token and webhook-secret fields remain empty, and uploads remain disabled. The review screenshot records a declined draft, not an issued credential. Stream's video page did not render its main content, so no subscription status was inferred.

The webhook secret depends on registering a reachable authorized endpoint. No endpoint/tunnel, subscription, token, resource or billing change has been created by this environment retrieval. Optional signing-key placeholders remain unused by the current API-token signing implementation. An independent verifier accepted the staged Supabase profile, ignore coverage, safe credential handling and local-preview preservation; that acceptance does not certify hosted activation. Operational budgets, licensed media and provider verification remain in [[03 Delivery/Release Checklist]].
