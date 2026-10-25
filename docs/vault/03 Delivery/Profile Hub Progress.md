# Profile hub progress

[[Home]] · [[03 Delivery/Minimal Profile Review]] · [[03 Delivery/Profile Hub Verification]] · [[03 Delivery/Profile Design System Check]]

User request: private account management, content uploads, content statistics and saved light/dark appearance. Latest direction: “dont put everything make it neat and minimal so user dont be overwhelmed”.

## Current direction and implemented surface

The 2026-10-24 minimal-profile request supersedes C's all-visible overview composition. .impeccable/surface-profile.md is the current contract; .impeccable/history/profile-overview-before-minimal.md preserves the earlier brief. The former C mock, detector and fixes-only finish evidence remain historical, not the new fidelity target or approval for this refinement.

/profile now opens a compact Account summary with four rows and Edit details. Semantic Account, Content, Statistics and Appearance tabs expose exactly one panel. Arrow Left/Right, Home/End, supported hashes and Back/Forward select the task. Inactive tasks remain mounted so unsaved account edits and an opened creator studio retain their state across task switches. Edit details reveals the existing validated form; Save returns to the summary and Cancel restores saved values. More settings discloses interests and optional personal information.

Content alone contains the real studio opener, owned records and unavailable-upload explanation. Statistics shows actual retained counts with About these numbers for the daily-credit definition. Appearance uses compact native Dark/Light radios and decorative Moon/Sun SVGs. Identity initials are 64/56px; the page title is 28/24px, the profile caps at 1040px, and actions retain comfortable targets. Only /profile omits the repeated shared footer. Global DM Sans, serif film-title usage, all 23 dark/23 light semantic colors and other routes remain unchanged.

## Current bounded evidence

Independent functional **ACCEPT** covers **27 tests in three files**: navigation (3), profile routes (5) and appearance (19), plus independent typecheck and scoped ESLint. The parent passed the production build with **38 pages**. Builder formatting and parent AppShell formatting pass. The earlier **183-test/22-file** whole suite belongs to the preceding profile implementation; it was not rerun for this UI refinement, whose backend contracts are unchanged.

Parent browser checks record one visible panel and zero main inputs at default Account; account edit, cross-tab unsaved-name retention, Cancel restoration, invalid-phone focus/recovery, and unchanged Save returning to summary. More settings links were checked. The studio application's unsaved input survived Statistics → Content without submitting an application. Keyboard task navigation, Back/Forward hashes and actual Light save/reload persistence passed; Dark was restored afterward. DOM checks found no overflow at 390, 1440, 2496 and the user's actual 885 CSS-pixel viewport. A 390px CSS phone viewport exports 380px full-page PNGs.

Eleven captures in .impeccable/review/profile-minimal/ record Account, editing, Content, Statistics, Appearance, mobile Light, wide and actual-user layouts. Parent and the independent finish reviewer opened all valid captures. The single retained detector snapshot reports **one advisory / zero nonadvisory findings**, for the local 28px heading now recorded in DESIGN. It was not rerun to erase that historical result. Fresh finish verdict: **SHIP for the current minimal-profile scope**, with no material corrections; persistence matches the current contract. See [[03 Delivery/Minimal Profile Review]]. Parent final browser inspection leaves Local Preview signed in on the default read-only Account summary with More settings closed.

## Existing backend and statistics contracts

The preceding owner-only /api/me/profile slice and migration 011 remain unchanged. Every mutation compares X-AIVerse-Account with trusted Auth before mutation; the header never assigns ownership. Edits cannot change owner, role, status or email and preserve consent, ethnicity, interests, completion and public alias. Its original independent backend 11-test ACCEPT, real cookie/PostgREST integration and three exact integration-fixture cleanups remain historical evidence in [[03 Delivery/Profile Hub Verification]]. No new migration, database reset or provider operation occurred in this refinement.

Totals span retained owned videos, including hidden/rejected content and excluding terminal removed state; the recent list is limited to 20. Recorded completions are retained viewer/video/UTC-day credits, not lifetime views or unique viewers. Revision workflow counts may overlap. The persistent viewer-only Local Preview account remains signed in for the user; it is not a disposable fixture to clean up.

## Remaining gates

Current functional ACCEPT and visual SHIP apply only to this minimal-profile refinement. The original plates/semantic asset-plan review and comp CLI/skill sequencing mismatch remain open; the current or historical scoped verdicts do not waive them. No new raster assets ship. Stream remains unconfigured, so actual upload/player verification remains unavailable. Earlier home/auth artwork/method, real Google/hosted service, policy and overall release gates remain separate and open.
