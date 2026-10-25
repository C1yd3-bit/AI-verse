# Local moderator and accessibility hardening

2026-10-25. User authorized the local hardening slice, then explicitly approved two disposable local accounts with moderator/creator roles after automatic review required that specific permission. Dedicated `aiverse-ana` only; Cloudflare remains unconfigured.

## Implemented repairs

The review queue previously left decisions active during refresh, allowed overlapping submits before render, and unlocked a completed decision before its queue reload finished. Requests were not bound to the displayed account or canceled after identity loss. A manipulated unknown decision could become a rejection. Removed queue rows could leave keyboard focus without a useful destination.

`ModerationPanel` now serializes refresh/decision work, disables every decision during an active operation, bounds requests to fifteen seconds, aborts obsolete work and suppresses late updates. A confirmed save waits for fresh queue data; failed reload retains the saved confirmation and a Refresh recovery action. Recoverable submission failures preserve input; terminal access/conflict responses clear stale private rows. Success uses a status announcement, errors use alerts and field associations, and removed-row decisions restore focus to Refresh.

The session follows the last confirmed account while ordinary focus/visibility checks are pending. The independent verifier caught an initial regression that would have discarded a draft during these same-account refreshes; it was corrected and independently tested. Explicit account-change/unavailable events invalidate immediately. Moderation GET and decision POST compare an optional `X-AIVerse-Account` against trusted cookie identity; legacy callers remain supported and ownership/role authority still comes from Auth and SQL.

Composition, CSS, artwork, tokens, dependencies, SQL and environment files are unchanged. DESIGN and sidecar hashes remain unchanged. The single changed-target detector returns `[]`.

## Automated and actual HTTP evidence

- Full suite: **409 tests in39 files PASS**. New actual-component26 cases and route13 cases cover pending/empty/malformed queue, retry, double submit, timeout, unmount/identity races, same-account draft retention, saved-but-reload-failed continuity, field errors and focus recovery.
- Final global TypeScript, ESLint, formatting and unchanged Next production build PASS;40/40 generated pages. No deployment.
- Independent implementation verifier: **ACCEPT**,99 targeted tests/eight files, TypeScript, scoped lint/format. Prior representative public/player/assistant baseline90 tests also passes at its source/controlled-test scope.
- Ten actual authenticated HTTP checks: moderator queue200 with viewer/moderator roles and no applications; allowed report operations projection200 with no admin summary/appeals; stale-account GET/POST409; admin-only creator application, suspension and quota mutations403; creator-only draft creation403; wrong-origin decision403; invalid reason400. Responses retain private no-store. A separate helper session signs out locally without affecting either browser session.
- Actual local role RPC denies granting admin access, and the moderator cannot create a film revision. No SQL authorization change was necessary.

## Actual browser evidence

The moderator signed in normally at `http://localhost:3000` while the user's persistent viewer remained on `http://127.0.0.1:3000`. Host-scoped cookies kept the sessions separate.

The real queue showed the two exact synthetic pending revisions, disclosure, rights statement, duration and labels, with no creator-application controls. Open private preview produced the honest `Playback is not configured` failure with no live iframe. Keyboard Down/End selected approval/rejection, Tab reached Reason then Record decision, and Enter submitted both exact fixtures. Actual states changed to one published and one rejected revision; guest `public_catalog` exposed only the approved synthetic record before cleanup. These are local metadata/state transitions using simulated ready-provider facts, not approval of actual footage or proof of video delivery.

The second decision's pending state exposed disabled refresh/select/reason/submit controls. Both settled decisions announced success and restored focus to Refresh. The queue then showed its real empty state. Skip to content followed by Tab reached Refresh without repeated navigation. Profile Left/End selected Statistics/Appearance, and Light appearance saved on the disposable account.

All five final captures in `.impeccable/review/local-hardening/` were opened by the parent and fresh finish reviewer: desktop/mobile dark/light queues plus the successful empty light queue with visible focus. Requested viewports1440x1000 and390x844 export full-page widths1430 and380; measured phone document clientWidth/scrollWidth380/380, desktop1440/1440, and inspected review buttons at least44px high. Full-page heights reflect content rather than viewport height. No horizontal overflow or material visual repair was found. Fresh disposition **ship** applies only to this refinement; see [[03 Delivery/Local Hardening Design Review]].

## Cleanup and limits

Moderator browser logout completed before cleanup. The guarded helper removed only the two exact disposable accounts and dependent synthetic content, simulated assets/events and audits; no real provider deletion occurred. Independent SELECT-only verification checked28 exact-ID scopes, all empty, and preserved the original viewer IDs plus eight private/profile/role/preferences/media data hashes. Temporary credentials are removed. Original Local Preview remains signed in on Reels; its Dark setting and account data were preserved. The temporary loopback test proxy was stopped and its browser tab closed.

Network failure/retry races are proven by controlled actual-component tests. A separate browser fault-injection proxy did not hydrate successfully, so no browser-level injected network-failure pass is claimed. Actual browser evidence covers the configured-off preview error, pending controls, successful decisions and empty recovery. Exhaustive screen-reader, physical touch, reduced-motion/high-contrast runtime, broad performance and cross-browser audits remain unverified. Real Stream, hosted identity, operational policy and overall release gates remain open in [[03 Delivery/Release Checklist]].
