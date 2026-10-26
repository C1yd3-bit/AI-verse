# Storage Upload Verification

[[Home]] · [[03 Delivery/Roadmap|Roadmap]] · [[02 Architecture/Decisions#ADR-024 — Private Supabase Storage replaces active Cloudflare video delivery|Storage decision]] · [[02 Architecture/Media Provider|Media provider]] · [[04 Operations/Local Development|Local development]]

2026-10-26. The user explicitly requested removal of Cloudflare from the active path and actual video uploads using existing services. **Local actual upload/private native playback and final scoped verification ACCEPT; design persistence receives scoped SHIP.** Local and hosted018–020 are applied, and hosted `media-storage` Edge v1 is active. **Git/Vercel application publication and hosted binary/authenticated journeys remain PENDING.** Source and local evidence do not establish a completed hosted upload journey.

## Current active contract

- Private bucket `aiverse-videos`; MP4/H.264 files at most50,000,000bytes under the current free-plan cap. Movies retain20minutes, Reels3minutes and quotas3uploads/day/30minutes/month. The unchanged supplied full-film originals exceed50MB; the prior500MB/TUS contract is dormant Stream code only.
- Verified, unsuspended owners prepare drafts without a creator application or role grant. Rights/AI attestation, quota reservation, immutable versions and human review before public discovery remain required.
- Browser bytes use signed direct PUT without overwrite. SQL ingress expires after15minutes, while the Storage upload token remains usable for two hours; these are distinct boundaries.
- Server Edge Function `media-storage` uses the platform's built-in service key, without adding a Vercel privileged secret or Cloudflare credential. It performs bounded container/sample-extent, duration and codec checks, not full decoding or transcoding.
- Raw Storage SELECT is denied even to owner/moderator callers. The Edge service gates signed native-video URLs; actual token expiry cannot exceed the initial duration-plus60seconds cutoff, capped21minutes Movie/five minutes Reel.
- Failed/hidden objects become ineligible immediately. Physical deletion waits until reservation expiry plus2hours5minutes, then uses at most three service-only leased jobs per opportunistic pass. There is no automatic cleanup cron or immediate physical-revocation guarantee.

## Actual local verification and cleanup

The parent suite passes **704 tests across57 files**, global TypeScript/ESLint/formatting. An initial sandbox lint module error cleared on the outside-sandbox rerun. Local webpack production build passes **41/41 pages before the final four CSS selectors/native-Reel adaptations**; five affected profile tests pass after its availability check switched from the Stream flag to Supabase configuration. The final published-source CI run is still pending and must cover those latest source refinements. No full-suite rerun after the final profile change is inferred.

Earlier independent source/SQL snapshots covered42 focused tests and13 Storage/41 related backend tests. Actual functional/runtime verification then passed43 tests (30 Edge/route and13 Storage SQL); the final hosted/profile review returns ACCEPT with48 targeted checks. These attributed layers are distinct from a full hosted user journey.

The initial HTTP503 came from the historical stack excluding Storage. A data-preserving restart using CLI2.122 enabled Storage/Edge with local018–020 retained and33 old scope hashes preserved, including the then-present verification fixture. The original local data was not reset.

Actual local browser use of the existing viewer attached and signed-PUT a generated2870-byte, two-second H.264 MP4. Edge inspection supplied authoritative bytes/duration and completion placed it pending human review. Native private preview reached `duration=2`, `currentTime=2`, `ended=true`, `readyState=4`, dimensions160×90 and no video error. This is real local binary delivery, not a simulated player or public publication.

Desktop client/scroll widths are1430/1430; phone requested390 has380/380. Independent review accepted the captures. The Studio brief/DESIGN persistence FIX was corrected and re-scored scoped SHIP; earlier formal method gates remain open. Exact synthetic cleanup is complete, retaining the original owned video identifiers, viewer and `viewer` role. No original user film was modified, trimmed or transcoded.

## Hosted application and limits

Hosted migrations018/019/020 were applied in original order, followed by an up-to-date remote dry run. All32 original public-table/Auth digest scopes are unchanged. The hosted baseline already had one real Auth user and one user-created private draft, with zero public catalog rows; those records were not agent-created and remain preserved. The private bucket has the50MB cap.

Hosted `media-storage` v1 is ACTIVE, with exact readback of its four source files. Its gateway setting `verify_jwt=false` supports mixed public playback and private completion; private actions validate JWT identity inside the handler. Four cookie-free hosted probes pass: guest completion401, missing public media404, malformed authentication401 and forged token401. No hosted account or media write occurred, and no new privileged Vercel secret was installed.

Fresh hosted advisors report **54 OPEN instances across five categories**:6 RLS/no-policy INFO,2 definer-view ERROR,5 anonymous-definer WARN,40 authenticated-definer WARN and1 leaked-password-protection WARN. The47 definer instances plus seven other instances differ from the previous50-instance historical report. No findings are declared resolved or suppressed, and there is no clean-security claim. [RLS guidance](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), [view guidance](https://supabase.com/docs/guides/database/database-linter?lint=0010_security_definer_view), [anonymous RPC guidance](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [authenticated RPC guidance](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [password guidance](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)

Git/Vercel application publication, final source CI and hosted actual-binary/authenticated browser journeys remain pending. The current local proof does not accept hosted delivery, human-review/public-playback end to end or the entire release. Cloudflare is no longer an active prerequisite; no Cloudflare credentials, subscription or billing were added. Legacy adapters remain isolated for reference/tests.

## Primary service references

The50MB free-project ceiling is documented in [Supabase file limits](https://supabase.com/docs/guides/storage/uploads/file-limits). Signed upload URLs last two hours per [createSignedUploadUrl](https://supabase.com/docs/reference/javascript/storage-from-createsigneduploadurl). Private assets require authorized or signed delivery per [Storage serving](https://supabase.com/docs/guides/storage/serving/downloads); built-in server credentials are described in [Edge Function environment variables](https://supabase.com/docs/guides/functions/secrets). Application-specific15-minute ingress and delayed cleanup are stricter local contracts, not claims that the platform shortens a signed token's lifetime.

This documentation task changes no SQL, source, environment, account, service, Git commit or deployment. Final publication results will be recorded separately after parent verification.
