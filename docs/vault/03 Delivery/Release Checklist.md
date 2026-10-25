# Release checklist

[[Home]] · [[03 Delivery/Roadmap|Roadmap]] · [[03 Delivery/Verification|Verification]] · [[04 Operations/Runbook|Runbook]] · [[02 Architecture/Media Provider|Media provider]] · [[02 Architecture/Trust Controls|Trust controls]]

This is an open release gate ledger, not a claim of production readiness. Local functionality is implemented across foundation, media, discovery and trust, with SQL and local HTTP evidence. Independent final acceptance lives in STATE.md and reviewer records. Record owner, date and evidence when closing each external gate.

## Local acceptance

- [x] Complete-film extension:588 tests/51 files/global checks/build40 and independent308 tests/17 files/eight SQL probes pass. Movies20min500MB/TUS/long tracking locally verified, migration015 applied without reset, exact fixture cleanup preserves original viewer. Actual Stream upload/playback/removal and overall release remain open. See [[03 Delivery/Full Film Verification]].
- [x] Latest creator-upload/thumbnail extension:530 tests/49 files, global checks and build40/40 pass; independent234 targeted tests ACCEPT and fresh scoped ship. Local thumbnail save/reload/approval/public read verified; synthetic fixtures removed across29 scopes with nine original baseline hashes preserved. See [[03 Delivery/Studio Upload Verification]]. No real video/provider operation is inferred.
- [x] Latest moderator hardening:409 tests/39 files, global TypeScript/lint/format and production build40/40 pass; functional ACCEPT and bounded refinement ship. Exact evidence and remaining accessibility limits: [[03 Delivery/Local Hardening Verification]]. Earlier totals below retain their historical scope.
- [x] Final combined typecheck, lint, formatting, 128 tests in 15 files and production build pass (parent run after 008; see Build Log).
- [x] Local HTTP Auth/Mailpit/PKCE/preferences/library and media concurrency/version/replay/hide integration pass after migration 008.
- [x] Observed local authenticated library/creator/administrator browser workflows verified after explicit human approval. Fourteen valid 1440/390-width captures were opened by parent and independent finish reviewer, with no overflow or material visual blocker. Both disposable personas/dependent records were cleaned up. See [[03 Delivery/Authenticated Browser Verification]].
- [x] Distinct moderator-only local browser verification: native keyboard approval/rejection, empty/status/focus recovery and actual HTTP admin/creator denials pass. Approved disposable accounts/content removed with independent exact-ID cleanup and original viewer preservation.
- [ ] Complete actual provider-player coverage and final overall release review. Exhaustive assistive-technology, reduced-motion/high-contrast, physical touch, cross-browser and performance acceptance remain unverified.
- [ ] Human design/asset acceptance and recorded Impeccable method gate are resolved explicitly.
- [x] CI source is reviewed and YAML/formatting validated; no secrets or deployment steps are present.
- [ ] When repository upload is authorized, a real remote CI run passes. No repository upload has occurred.

## Hosted identity and delivery

- [ ] Dedicated hosted test Supabase configured with exact origins/callbacks, confirmation policy, SMTP and cookie/session behavior verified across two real accounts.
- [ ] Licensed test media and creator authorization recorded privately.
- [ ] Configured Stream direct binary upload, processing, signed-only private preview and exact-version moderation/publication exercised.
- [ ] Guest playback of approved media and denial for private/revised/hidden/removed/suspended content exercised against real services.
- [ ] HTTPS webhook registration/authentication/replay and missing/late delivery recovery proven.
- [ ] Uncertain grant outcome recovered using verified UID/operation binding; unbound assets remain private/quarantined.
- [ ] Authenticated media maintenance worker, provider deletion, retry and ten-attempt exhaustion recovery proven.
- [ ] Duration-derived playback policy approved and existing signed token/segment/cache/thumbnail revocation measured. Migration015 extends Movie windows to verified duration plus60seconds, minimum60/maximum1260; Reels retain maximum300. Original expiry and post-provider entitlement checks remain. An existing Movie token can last21minutes; this is not an approved or measured revocation SLA.

## Policy and operations

- [ ] Upload budgets/duration, UTC allowance accounting, overrides and failed/rejected entitlement policy approved.
- [ ] Actual provider storage/delivery metrics, cost owner, alert thresholds and escalation configured and tested.
- [ ] Retention cutoff/schedule and separate case/audit retention approved. Leave `AIVERSE_RETENTION_DAYS` empty until then; a configured 30–365-day worker setting is a mechanism, not approval.
- [ ] Backup/access/encryption/retention configured; isolated restore drill meets approved recovery objectives.
- [ ] Rights attestation, prohibited-content, reporting, takedown, privacy and appeals procedures reviewed by accountable owners; no placeholder presented as legal policy.
- [ ] Incident owner, restricted audit access, credentials rotation and restore/deletion recovery procedures verified.
- [ ] Accessibility, performance, browser compatibility and abuse review meet agreed release requirements.

## Beta and publication

- [ ] Real creator cohort and rights-cleared catalog onboarded; no invented records or usage claims.
- [ ] Actual service reliability, moderation load and costs observed over an agreed beta window.
- [ ] Accountable release decision recorded with unresolved-risk disposition.
- [ ] Hosting/domain/production changes and public deployment explicitly authorized and verified.

Until these gates close, report the result as a locally implemented MVP with explicit external/human gates. Do not label it a launched or fully accepted service.
