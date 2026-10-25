# Decisions

## ADR-022 — User-authorized complete films and large uploads

On2026-10-25 the user explicitly chose full-film support for the two supplied, permission-attested films. Movies now cap at1200seconds/500000000bytes; Reels retain180seconds. Shared application policy plus additive migration015 enforce immutable format, private review and observed tracking. Files above200000000bytes use server-created private TUS, with canonical opaque upload URLs and separate provider IDs, HEAD/8MiB PATCH offset validation, progress/cancellation and no automatic ambiguous regrant. Smaller files retain multipart. No transcoding or original-file mutation is required.

Preserve default3uploads/day and1800seconds/month; reserve at most the format cap or remaining entitlement, then charge verified actual duration. The supplied737/930-second pair fits when sequential reconciliation releases the first unused hold. Signed Movie windows use verified duration plus60seconds, maximum1260; existing signed access may therefore remain up to21minutes after new grants are denied. This local full-film implementation does not approve a revocation SLA, external costs, token creation or deployment. Actual Stream operation remains separately gated. See [[03 Delivery/Full Film Verification]].

## ADR-021 — Uncertain transfers and immutable revision thumbnails

Implemented locally in the authorized media-readiness slice. Binary transfer progress measures bytes sent, not processing/publication. Persist an account/version recovery journal before grant issuance; uncertain outcomes, cancellation and reload require status/operator recovery rather than automatic new grants. Keep bearer URLs/tokens and file data out of persisted browser state.

An optional normalized still-image cover belongs to an immutable film revision. Only its verified creator can edit the latest unreserved draft; reservation freezes it for exact-revision moderation. Image bytes enter through bounded authorization/normalization and a sealed service RPC that repeats eligibility under locks. Moderators must load/decode a present thumbnail before recording a decision. Public reads require the exact active published version and eligible creator, use no-store, and never fall back to private cookie access. Live artwork bypasses the Next optimizer; public projection adds only a boolean, not private image/provider fields. No new visual system or hosted provider service is introduced. Local ACCEPT does not authorize Stream billing, credential creation or live media rights.

## ADR-020 — Explicit Reels viewing and bounded playback activity

User selected immersive B composition and explicitly made mock artwork reference-only in favor of the approved assets. Preserve the existing portrait grid; exact published reel results open a separate bounded viewer with canonical source filters/history. Adjacent reels never preload a live player. Explicit playback uses the existing entitlement grant and at most one active iframe; media/page/account lifecycle boundaries cancel stale work and stop the player.

Migration013 adds service-issued private playback sessions bound to verified owner, exact approved public version, trusted duration and absolute expiry. Actual SDK playing/time events observe unique ranges with seek/replay/wall-time guards; progress requires verified account, same origin and a matching comparison header. Server admission uses total elapsed time with two seconds of total slack, avoiding both receipt-jitter rejection and retry allowance inflation. Monotonic completion reaches90% once per owner/video/UTC day and feeds existing retained recommendation/profile signals; it is not a public view count or proof of attention. Guest/demo/private review generates no account tracking. Local database and controlled SDK tests establish implementation behavior; real Stream operation and release remain open. See [[03 Delivery/Reels Viewing Review]].

## ADR-019 — Stateless rule-based discovery assistant

User authorized Ask AIVerse and selected the right-side drawer on 2026-10-25. A same-origin public POST translates bounded messages/current filters through deterministic parsing and existing published-only discovery. Unsupported exclusions/mixed requests clarify rather than silently changing intent. Runtime response schemas enforce public fields, local/canonical links, bounded result lists and honest counts. No private account attributes, LLM, embeddings or chat storage enter the retrieval path. Existing owner-derived saved-Fusion RPCs remain authoritative; a comparison-only header protects the assistant's account-bound save variant, with backward-compatible legacy callers. Browser memory caps at eight turns, with per-response save state and confirmed account-loss clearing. The selected A visual extension keeps existing semantic palettes and DM Sans, with component-local drawer geometry, conversation shapes, backdrop, focus and reduced-motion rules recorded in DESIGN.md and its sidecar. Shared-region copy states only the regional filter actually present. Actual app validation is separate from historical comp-method/release gates; same-reviewer finish confirmation remains pending. See [[03 Delivery/Discovery Assistant Review]].

## ADR-018 — Small private profile photos

The user's avatar-edit request adds verified-owner photo selection to the private account hub. Store only normalized 256px WebP (maximum 64 KiB) in owner-private `account_avatars` with an Auth-user deletion cascade; a bounded small avatar requires no external provider. Original photos/metadata are not retained. Migration 012 applied only to the dedicated local stack without reset. Session-derived RPCs/owner-read RLS protect persistence; routes add same-origin mutation and stale-account comparison guards. No public creator/profile projection change. Later public avatars or original-image storage require a separate product/privacy decision. See [[03 Delivery/Profile Photo Review]].

[[Home]] · [[02 Architecture/System Overview|System overview]] · [[03 Delivery/Roadmap|Roadmap]]

Recorded 2026-10-24. Accepted contracts below define implementation direction. Unless explicitly stated in the Build Log, they are not evidence that a feature or integration has shipped.

## ADR-001 — Modular monolith and provider boundaries

Accepted. Follow the supplied Next.js/Supabase/Cloudflare plan. Supabase is canonical for application state; Stream handles binary media. Keep development fixtures isolated from production adapters. No paid LLM is necessary for initial search.

## ADR-002 — Administrator-only creator approval

Accepted. Only an audited administrator server operation grants or revokes creator privileges. Moderators may review content and reports but cannot grant creator roles. Additive roles still apply; self-service profile updates never change roles. This resolves broader approval language in the original agent instructions.

## ADR-003 — Content versions bind review

Accepted and implemented locally. Review approves a specific immutable asset/version and its reviewed metadata. Replacing an asset or materially changing title, description, tags, AI disclosure or thumbnail produces a new pending version. The local choice keeps the existing approved version public while a revision awaits review; it never points at the unreviewed revision. Publication verifies the reviewed version transactionally. Local SQL and HTTP tests exercise version isolation; real provider review/playback and operational acceptance remain open.

## ADR-004 — Public projection and private data

Accepted and implemented locally. Public video metadata uses an explicit allowlist/projection backed by database privileges. Provider identifiers, private preview material, moderation notes and failure details stay restricted. Ordinary creators cannot write owner, status, roles or review fields. Migration 006 adds a public creator projection instead of exposing private profiles; creator/tag pages use public discovery boundaries. Local SQL/HTTP checks cover fields, mutations and row visibility; hosted verification remains open.

## ADR-005 — Atomic upload reservation and reconciliation

Accepted and implemented locally. Reserve upload count and maximum authorized minutes atomically before provider grants, with idempotency, per-owner locks and expiry. Real local PostgREST races prove four concurrent requests yield three holds/one denial. Reconcile actual duration from trusted evidence and release abandoned reservations; provider costs remain distinct from entitlement. UTC calendar days/months and proposed limits of three uploads/day, thirty minutes/month and three minutes/video remain local policy choices awaiting live operational approval, including failure accounting/expiry/overrides.

Provider/database operations cannot share a transaction. Persist an operation key and recoverable state; reconcile provider success followed by database failure, missing callbacks and duplicates. A late processing event cannot republish hidden or removed content.

## ADR-006 — Removal and revocation

Accepted and implemented locally for application denial and durable cleanup. Hiding/removal excludes public discovery/new playback entitlement. Deletion jobs use leases, backoff and ten-attempt exhaustion; queued/deleted assets cannot be revived by late reconciliation. Real provider/token/thumbnail/cache behavior still requires measurement and an approved revocation objective before beta. Retention, appeals and hard-deletion timing require explicit operational policy; local mechanisms do not imply that approval.

## ADR-007 — Discovery and onboarding semantics

Accepted. Fusion is OR among selected regions, OR among selected genres and AND across dimensions, format and language restrictions. Global/Any removes the region constraint. Canonical URLs must round-trip these filters. Exact matches precede explicitly labeled broader results, all from actual published records.

Completed onboarding requires 5–8 valid unique taxonomy genres; optional regions are validated too. Skip is an explicit state with empty interests. Settings reuse this contract. Content interests describe content, never ethnicity. Movies initially means short films subject to the same proposed maximum duration.

## ADR-008 — Atomic preference row

Accepted local implementation choice. Use one `viewer_preferences` row per user with genre and content-region arrays, onboarding state and an owner-scoped server RPC, rather than the original `viewer_genre_preferences` and `viewer_region_preferences` joins. This lets a complete selection/state update commit atomically without partial multi-table saves. The RPC derives the user from the session, validates taxonomy membership/cardinality/uniqueness and enforces skip versus completion. RLS restricts reads to the owner; direct write privileges must not bypass the RPC. Browser fixtures use a clearly labeled local adapter.

Function permissions, pinned search path, cross-user denial, taxonomy and invalid states have local SQL coverage; real local Auth/HTTP preferences and owner isolation are also exercised. Hosted verification remains separate. A future normalization migration may retain the same service contract if query requirements justify it.

## ADR-009 — Canonical languages and missing domains

Accepted and locally implemented. `video_languages` is the version-specific canonical multi-language association, without a competing singular video language field. Not Interested, suspensions, quota overrides, reservations, callback deduplication, appeals and deletion jobs have explicit persistence/RPC boundaries with local authorization evidence. External service behavior and policy approval remain separate gates.

## ADR-010 — Source preservation and agents

Accepted. Preserve the supplied documents unchanged. Root `AGENTS.md`, `LOOP.md`, `STATE.md`, `PRODUCT.md` and these companion decisions carry current guidance. Agent role files are reusable definitions in `.cursor/agents` with matching `.agents/agents` copies; this Codex session dispatches them explicitly. Automatic discovery by another harness has not been verified.

## ADR-011 — Fair private processing and terminal deletion

Accepted local implementation in migrations 005/007. Internal helper privileges prevent direct queue poisoning. Processing work claims up to ten rows per worker request using least-recently-polled ordering and two-minute leases, preventing early unfinished assets from starving later ones. A deletion job changes the asset to `deleting`, including a backfill for existing jobs, and terminal callbacks cannot reset it to ready. Worker expiry/deletion and optional approved retention remain separate stages. Live cadence/recovery monitoring has not been measured.

## ADR-012 — Bounded ranking and private feedback

Accepted local choice. Recommendation candidates are limited to 500 published records; freshness comes from trusted catalog publication timestamps, with owner-scoped likes/follows/Not Interested and bounded completion signals. Weights and exploration are hypotheses, not observed retention improvements. Broader retrieval/ranking requires a later measured decision.

## ADR-013 — Local verification and release evidence

Accepted. Real local Auth/PostgREST tests and captured-mail PKCE confirmation provide stronger evidence than fixtures, but do not prove hosted SMTP/cookies or Cloudflare. The original automatic refusal of privileged browser personas was resolved only after explicit human approval for disposable isolated `aiverse-ana` verification. Creator/candidate/administrator browser workflows now have observed evidence and independent visual review; both accounts/dependent records and temporary credentials were removed. A moderator-only browser session remains untested, distinct from proven moderator SQL/HTTP privilege boundaries. Test totals, final verdicts and human design acceptance stay in parent/reviewer records; never infer a launched beta from code completeness. See [[03 Delivery/Authenticated Browser Verification]].

## ADR-014 — Duration-derived bounded playback

Accepted local implementation choice in migration 008, pending policy/live acceptance. Replace the fixed sixty-second iframe token window with verified version duration plus sixty seconds, bounded to a minimum of sixty and maximum of 300 seconds. Carry the original absolute entitlement expiry through provider calls and recheck asset/version eligibility afterward, so latency or takedowns do not silently extend/return an ineligible grant. This avoids interrupting a three-minute film solely because the token expires after one minute. Existing-token/segment revocation still needs actual Cloudflare measurement; the bound is not an approved public removal SLA.

## ADR-015 — Local Supabase for now

Accepted by the user's explicit instruction to put the database in local Supabase for now. Use isolated project `aiverse-ana`, API `http://127.0.0.1:55321` and the active ignored `.env.local` for account persistence and database development. Preserve existing local data. The ignored `.env.hosted.local` profile remains staged, inactive and deferred; do not mutate its hosted project or treat hosted activation as a blocker to local work. Any future activation requires a separate decision and verification. Demo artwork/catalog fixtures remain distinct from the real local account backend. The user declined a Cloudflare Stream token, so Stream stays unconfigured and uploads disabled. This backend choice is not evidence of an additional integration pass or approval for public release.

## ADR-016 — Private account onboarding and explicit optional self-description

User-requested local design/implementation choice, now implemented with migrations 009/010 and locally verified. Confirmed-email account onboarding uses private `account_details` and an atomic owner-derived completion RPC alongside shared interests. Private full name never becomes public display name. Age 1–120 is a plausibility constraint, not an eligibility/legal policy; contact is not SMS verification. The code-only OTP email has no fallback confirmation link.

The user's optional personal ethnicity request changes the original no-collection direction only for explicitly consented private self-description. A description requires affirmative consent/timestamp; omission clears it and consent. Never infer ethnicity, expose it publicly, conflate it with content-region interests or use it for ranking. Separate retention/correction/deletion, access and minor/privacy policy approval remains a release gate. Local integrations prove verified identity, isolation, rollback and consent revocation; observed browser review covers the new account journey without claiming exhaustive accessibility or hosted operation.

Auth/onboarding uses approved mock B Cinematic split with catalog-thumbnail carousel; home retains A without a carousel. Email/password signup uses six-digit OTP/resend. Google readiness is false and real Google PKCE remains externally unconfigured/unverified. Independent backend acceptance does not close formal design disposition FIX for static-plate/method persistence, nor prior artwork/service/policy release gates. See [[02 Architecture/Account Onboarding]] and [[03 Delivery/Auth Onboarding Verification]].

## ADR-017 — Private profile and account appearance

User-selected local implementation, visual direction **C — complete profile overview**. `/profile` is the private account hub; legacy `/dashboard` redirects there. Migration 011 stores owner-private appearance alongside guarded private-basics updates and owner-only projections. All POSTs require a comparison-only `X-AIVerse-Account` matching trusted verified Auth; a mismatch fails before mutation. The session still derives ownership. Basics updates preserve optional consent/self-description, interests, roles, onboarding and public alias.

Summary statistics aggregate all retained owned content independently of the recent-list cap of 20. Removed videos are excluded; daily credited completion records are retained engagement signals, not lifetime views or unique viewers. Inline studio/application panels reuse the established creator contract and cannot confer creator authority.

Global light/dark appearance is an authorized extension of the incumbent cinematic identity. The verified account's saved theme supersedes a device first-paint/guest fallback. Reads are generation-bound; saves retain their account identity/busy state across refresh, with post-acknowledgment revalidation when necessary. Theme application changes root semantic variables; cinematic artwork captions keep their own dark scope. CSS miniatures and initials require no new shipping raster.

Local backend and functional ACCEPT, real cookie/PostgREST integration and observed browser journeys are recorded in [[03 Delivery/Profile Hub Verification]]. Visual finish and formal method/asset-plan gates remain separate and pending; this ADR does not award SHIP or release approval. Stream stays unconfigured by the user's prior choice.
