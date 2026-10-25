# System overview

[[Home]] · [[02 Architecture/Decisions|Decisions]] · [[02 Architecture/ARCHITECTURE|Preserved source architecture]]

## Boundaries
The application is a modular Next.js monolith. Supabase owns authentication, canonical metadata, roles and row-level access. Cloudflare Stream owns video ingestion, encoding and delivery. Browsers send uploaded binaries directly to Stream using short-lived grants; Next.js never proxies the video file.

Keep server handlers thin. Business rules live behind typed services with explicit identity/context. Validate input at server boundaries with Zod. The browser never supplies trusted roles, owner IDs, publication state or quota usage.

## Local implementation and evidence
The application now includes foundation, creator/media, discovery and trust slices: real local Supabase sessions, preferences/library, creator applications/studio, version moderation, reservation/reconciliation/deletion, public video/creator projections, tags, recommendation/filter services, reports, suspension and appeals. PGlite tests exercise SQL/RLS; separate actual local Auth/PostgREST tests exercise captured-mail confirmation/PKCE, preferences/logout, library ownership and four concurrent quota requests. Provider facts in media integration are simulated; they do not establish Cloudflare upload, delivery or deletion.

The chosen preferences implementation uses a single owner-scoped row with genre/region arrays and a server RPC, rather than separate preference join tables. [[02 Architecture/Decisions#ADR-008 — Atomic preference row|ADR-008]] records this explicit divergence.

## Implemented boundaries
- Creator applications and administrator decisions have audited role grants.
- Immutable private versions, restricted provider records and version-bound review/publication protect the public projection.
- Reservations serialize per owner; operation leases prevent blind duplicate grant issuance. Binding returns whether an asset remains usable after state changes.
- Fair processing claims use least-recently-polled order and two-minute leases; deletion-queued assets become terminal for reconciliation and never re-enter processing.
- Published-only discovery and public creator projections support `/tag/[slug]` and `/creator/[id]`. Pagination/filter validation and stale-cursor rules bound retrieval.
- Recommendations use trusted publication timestamps, owner feedback and at most 500 candidate videos; this is a bounded initial ranking model, not evidence-based global optimization.
- Reports, suspension, incident-bound appeals, quota overrides and bounded telemetry/retention have explicit private state and authorization.

See [[02 Architecture/Media Provider]] and [[02 Architecture/Trust Controls]] for domain contracts. Provider measurements, delivery costs and policy approval remain open.

## Verification and remaining gates
Server identity checks and RLS must both deny access across accounts. Public video reads use an explicit field allowlist/projection; row visibility alone cannot protect private columns. No client-writable role, status or moderation metadata is trusted. Private previews require short-lived access and must remain private even if their asset identifiers leak.

Hardening migrations address privileged helper execution/queue poisoning, JavaScript UTF-16 length parity, unusable late provider bindings, fair processing leases and terminal deletion callbacks. Apply every ordered migration; do not infer current behavior from the foundation schema alone.

The recorded checks remain 128 tests across 15 files, a successful 32-page production build and 26 HTTP smoke checks; no source edits or repeated code checks were needed for the subsequent browser-review pass. After explicit human approval, two disposable local personas exercised creator/candidate/administrator workflows, including isolated revisions, rejection and incident-bound appeal/restoration. Fourteen valid responsive captures had no material visual blocker in independent finish review; exact accounts/dependent records and credentials were cleaned up. See [[03 Delivery/Authenticated Browser Verification]]. Moderator-only browser coverage is still distinct from tested SQL/HTTP moderator boundaries, and no actual video/provider I/O or publication occurred.

The parent checked configuration flags without exposing credentials: the database points to local API 55321, Stream uploads remain disabled and Cloudflare account/token values remain empty. Hosted identity/SMTP, licensed provider playback, measured revocation, backups/restore, budgets/retention/legal procedures, beta participation, deployment and human design/asset acceptance remain [[03 Delivery/Release Checklist|open gates]]. Overall release is not accepted; root STATE.md and reviewer records own acceptance. Preserved source architecture remains historical input; companion Decisions records local choices.
