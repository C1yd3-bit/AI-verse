# AGENTS.md — Codex instructions for AIVerse

## Mission and source of truth

Build **AIVerse**, a web-first discovery and viewing platform for authorized AI-created reels and short films. Read these files before any substantial changes:
1. `AIVERSE_CODEX_BUILD_SPEC.md` — product requirements, feature boundaries and acceptance criteria.
2. `ARCHITECTURE.md` — architecture, data flows, authorization, security and module contracts.
3. `AGENTS.md` — execution, coding and reporting rules for AI coding agents.

If instructions conflict: explicit current user request > repository/AGENTS conventions > architecture > product spec. Highlight significant conflicts in your final report and update docs when product or architecture decisions change.

## Operating rules

- Inspect existing files and `git status` before changes; never assume a blank repo or overwrite unrelated code. Never modify TapJob or another project.
- Make a short plan for nontrivial tasks, then implement **one working vertical slice**. Don't attempt the entire roadmap in one pass.
- Use existing package manager and framework choices when already established. For new repos, prefer Next.js App Router, TypeScript strict mode, Tailwind, Supabase Auth/Postgres/RLS, Cloudflare Stream adapter and Zod.
- Avoid unnecessary new dependencies, code generators and complex microservices. Prefer clear typed functions and small focused modules.
- Don't claim an integration works without testing it. When keys or external services are unavailable, provide `.env.example`, clear setup directions and explicit development-only adapters/fixtures. Never pretend test/demo media is live user content.
- Never deploy, charge money, register accounts, purchase services or modify remote infrastructure without authorization and appropriate credentials.
- Keep changes focused; don't leave broken scaffolds, unused placeholders or misleading TODOs presented as completed functionality.

## Product guarantees

- Guests can browse **published** videos without accounts. Registered viewers can store onboarding choices, favorites and saved Fusion filters.
- Viewer onboarding: suggest 5–8 genres; second step optional content-region/cultural inspirations (Korean, Filipino, Chinese etc.). **Do not collect or infer a viewer or creator's actual ethnicity.**
- Fusion mixes genre + culturally inspired content-region/style + format, with truthful exact matches and clearly differentiated fallback suggestions.
- AI helper retrieves actual database videos via metadata + text search. Never invent video matches or descriptions; use real LLMs/embeddings only when authorized and configured.
- Free creator signup/application; upload permission ONLY after moderator/admin approval. Initial uploads are quota-limited and ALL new videos require review prior to publication.
- Metadata includes hashtags (max 10, recommend 3–5), optional style region, genre, title, description, tool used, AI label and rights attestation. Hashtags are ranking hints, not guarantees.
- Paid Creator Pro, viewer premium, real ad serving, creator payments, native mobile apps and AI generation are **post-MVP**, not first-slice deliverables.

## Security and data safety

- Security is not optional. Implement Supabase RLS alongside server-side ownership and role checks. Role changes must be privileged and audited.
- Do not expose Supabase service-role keys, Cloudflare API tokens, private playback permissions or Stripe keys in client code or logs.
- Do not publish `draft`, `processing`, `pending_review`, `rejected`, `hidden` or `removed` videos. Public catalog, search, tags, AI helper and Fusion must filter `published` at the data-access layer.
- Video upload files go browser → Cloudflare via scoped short-lived direct upload authorization; never proxy large files through Vercel. Trust verified/reconciled provider state, not browser success messages.
- For private previews use signed authorized playback; verify moderation permissions. Validate all input, sanitize user content, enforce upload/rate limits and idempotent callbacks.
- Include a user reporting mechanism, rights attestation, AI disclosure, moderation audit entries and a credible removal lifecycle.
- Never store real API credentials or user information in seed data or tests. Ask for specific secrets only when essential, never request copying secrets into chat.

## Engineering conventions

- TypeScript strict; avoid `any` and nonnull assertions unless justified. Validate external/user inputs with Zod and constrain IDs, slugs and pagination.
- Put business logic in `src/features/*` or an equivalent established module structure; keep server handlers thin. Isolate provider operations in adapters.
- Server components for data-centric views, client components for video players and interactive filters. Accessible keyboard operations, meaningful labels and good mobile layouts.
- SQL changes are versioned in `supabase/migrations`; include indexes, FK constraints and RLS. Write migrations safe for a new DB; document backfill/rollback implications for an existing DB.
- Test authorization first, including negative cases: rejected creator cannot authorize uploads; unauthorized viewer cannot access draft; nonmoderator cannot publish; another user cannot change preferences; search/Fusion cannot leak nonpublished videos.
- Avoid expensive video prefetch. Treat streaming and storage spend as measurable product metrics.
- Explain added dependencies, unusual trade-offs and decisions in docs. Keep code readable for a small founding team.

## Execution protocol for each Codex task

1. Inspect repo structure, package scripts, git status, existing docs and relevant migrations/tests.
2. State scope in a small checklist; identify which external credentials are missing.
3. Implement focused feature slice with schema/RLS, server contracts, UI, and tests where relevant.
4. Run available checks (`typecheck`, `lint`, `test`, `build`; use actual package scripts). If they cannot run, state precisely why.
5. Review diff for accidental secrets, data leakage, unrelated file changes and security regressions.
6. Report: changed files, behaviors now working, commands/tests with results, known limits, configuration required, and recommended next slice.

## Initial Codex assignment (start here)

Read the spec and architecture, inspect repo, then implement **Phase 1 / Slice A** only:
- Scaffold app if empty; establish responsive cinematic layout and main nav for Home/Reels/Movies/Fusion/Search.
- Implement Supabase migrations/RLS for user profiles, additive roles, genres, content regions and viewer preferences.
- Build genre onboarding (5–8 chosen when completed; allow skip where required) and optional content region step; add profile settings to edit preferences.
- Include local demo content with clearly labeled mock records and no fake provider-playback assertions.
- Add `.env.example`, README setup instructions, basic auth/RLS tests and run current project checks.

**Stop after this slice and report results.** Subsequent slices should implement actual discovery, creator workflows and moderation in roadmap order. Do not silently advance to monetization features.
