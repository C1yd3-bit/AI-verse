# Trust controls and viewer state

[[Home]] · [[02 Architecture/Decisions|Decisions]] · [[02 Architecture/Media Provider|Media provider]] · [[03 Delivery/Roadmap|Roadmap]]

Implemented locally in migration `202610240003_trust.sql`, 2026-10-24. Thirteen tests execute the foundation, media and trust migrations against PostgreSQL/PGlite with emulated Auth roles. They cover actual row visibility, direct-write denial, allowed RPCs and negative cases. These checks do not prove hosted Supabase sessions, real delivery, concurrent multi-connection behavior or approved operational policy.

## Owner state

`saved_fusions` stores at most twenty named combinations per account. `save_fusion(filter_id, name, query)` creates or updates the authenticated owner's filter; `delete_saved_fusion(filter_id)` deletes it. Names are trimmed and bounded to eighty characters. Query objects use the `discoveryQuerySchema` shape: keywords, regions, genres, formats, languages, hashtags, and optional minimum/maximum duration seconds. The SQL boundary rejects unknown keys and taxonomy values, bounds arrays and size, applies NFKC/lowercase normalization, sorts/deduplicates selections, and converts Global regions into no region constraint. A Korean/fullwidth keyword test checks the shared canonical contract.

`set_video_signal(video_id, signal, enabled)` supports `like` and `not_interested`; `set_creator_follow(creator_id, enabled)` manages follows. Enabling requires published targets and an available creator. Repeated calls are idempotent. Disabling remains possible after a target disappears. No RPC accepts a viewer/owner identifier. Owner SELECT policies protect these tables; direct writes are revoked even for a signed-in account.

`record_watch_completion(video_id, session_key, watched_seconds, user_initiated)` accepts a UUID session key, a published version and explicit playback only. Provider-derived duration bounds claimed watch time. Each account can submit thirty events per UTC day; the same session is idempotent while retained and cannot be rebound to a different video. At most one ninety-percent completion per video/account/day receives credit. Additional sessions receive no additional credit. This is bounded client-reported telemetry, not proof of viewing, bot-proof analytics or billable delivered minutes. Autoplay is rejected rather than weighted as explicit engagement.

## Reports and creator access

`submit_video_report(video_id, category, details)` accepts `rights`, `harmful`, `misleading` or `other`, with five to two thousand characters. Five reports per UTC day is the proposed default. A profile-row lock serializes the account's rate-limit check and insert. Reports bind the published version at submission time. Reporters see their own reports; moderators/administrators can inspect the queue. Creators receive no general access to other people's reporting details.

`resolve_video_report(report_id, resolution, reason)` accepts `dismiss`, `hide` or `remove`, and only a moderator/administrator may act. A reporter cannot resolve their own report. Hiding/removal invokes the media moderation operation in the same transaction, and every resolution records an audit entry. Repeated decisions on a closed report are denied.

`set_creator_suspension(creator_id, suspended, reason)` is administrator-only and denies self decisions. Each active incident has its own immutable identifier and a private reason. The public boolean helper exposes only whether content access is blocked. Media-layer hooks deny new drafts, new reservations, upload grant acquisition, review/publication, public catalog reads and playback entitlements for suspended owners. Already issued delivery tokens retain their documented bounded validity; no immediate provider revocation is claimed. Existing published records stay intact while excluded from discovery, so reinstatement restores approved visibility without publishing an unreviewed version.

`submit_appeal(suspension_id, statement)` requires the caller's own active incident, a ten-to-four-thousand-character statement and at most three submissions in thirty days. One pending appeal per incident is allowed. `resolve_appeal(appeal_id, approved, reason)` is administrator-only, audited and bound to that exact suspension. Approving an old appeal cannot lift a newer incident. Appeal statements and suspension reasons are visible only to the affected creator and administrators.

## Quotas, telemetry and retention

`set_quota_override(creator_id, daily_uploads, monthly_seconds, expires_at, reason)` is administrator-only, denies self decisions and records an audit entry. Overrides permit one to one hundred daily uploads and 180–86,400 monthly seconds, expire within ninety days and keep the current per-video maximum fixed at 180 seconds. Passing null for all three limit/expiry arguments clears the override. Expired overrides fall back to the proposed defaults: three uploads/day and 1,800 seconds/month. The reservation transaction reads effective limits while holding the same profile lock used by policy changes.

`ops_summary()` is administrator-only and returns aggregate counts, pending work, estimated stored seconds, client-claimed daily watch seconds and credited completions. It returns no identifiers, provider URLs, report text or private notes. Estimated storage excludes confirmed deleted assets and is not a substitute for provider invoices; actual delivered-minute/cost monitoring requires a configured provider integration and live evidence.

`purge_operational_events(cutoff)` is service-role-only. A trusted worker must supply an explicitly approved cutoff retaining between one and 365 days. Each invocation removes at most one thousand old watch events and one thousand old provider events associated with confirmed deleted assets. Live-asset provider deduplication evidence is retained. The function configures no schedule and grants no implicit retention approval. Reports, appeals, suspension incidents and audit history require a separate approved case-retention/deletion policy and are not silently purged with telemetry.

All security-definer functions pin an empty search path and have explicit execution grants. Public/anonymous mutations and direct internal-helper execution are denied. Live use still requires operational approval of limits, retention, access review and measured token revocation behavior.
