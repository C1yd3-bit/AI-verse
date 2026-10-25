# Full-film design review

[[Home]] · [[03 Delivery/Full Film Verification|Full-film verification]] · [[03 Delivery/Studio Upload Design Review|Previous upload review]]

2026-10-25. Documentation comparison: **PASS**, bounded to the ordinary full-film extension. The user explicitly chose Movies up to **20 minutes / 500 MB**, retaining Reels at **3 minutes**. This changes factual copy and upload/playback behavior within the incumbent Operate composition. It establishes no new composition, artwork, visual direction or design system.

The fresh finish reviewer accepted all three required captures and found TYPE, MATERIAL, GROUND and composition consistent with the incumbent surface. Its initial exact **FIX** concerned only two stale policy records: `PRODUCT.md` still treated the full-film choice/current limits as unresolved, and `.impeccable/surface-studio.md` retained the old universal 200 MB multipart contract. Both records now describe the chosen policy and multipart/TUS split. The same fresh reviewer scored **both fixes resolved** and returned **`disposition: ship` for those two fixes only**. This is an attributed finish result, not this documenter's independent screenshot appearance verdict or whole-surface acceptance.

Historical Reels formal plates, comparison **DRIFT**, method persistence and the overall release decision remain open. The previous Reels comparison of **74.47% DRIFT** is inherited evidence, not a new comparison for full films. No phase, detector or context process was rerun by this documenter.

## Incumbent source comparison

Checked `PRODUCT.md`, `DESIGN.md`, `.impeccable/design.json`, `.impeccable/surface-studio.md`, global styles and font imports, Studio/Library styles, `StudioUploadForm`, `StudioPanel`, `ModerationPanel`, `OperationsPanel`, `FilmPlayer`, the shared media policy, upload client and TUS client. Architecture decisions and the full-film verification handoff supply the behavioral boundaries. No CSS changed in this extension.

| Dimension   | Comparison                                                                                                                                                                                                                                |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TYPE        | Match. DM Sans controls, ordinary headings, labeled native fields, helper text and tabular progress/metadata remain. No display face or type ramp is added.                                                                               |
| MATERIAL    | Match. Existing flat bordered inputs, 5px corners, quiet dividers and shared primary/secondary actions remain. Native selection/progress/cancel states reuse the existing form vocabulary.                                                |
| GROUND      | Match. Neutral dark/light semantic grounds, readable text and violet action/focus tokens remain. No palette primitive, shadow, decorative motion or artwork direction is introduced.                                                      |
| Composition | Match. The established heading, account/provider status, single-column form and separated revisions/queue remain. Studio panel width stays 820px, form/upload width 680px, and the existing 700px breakpoint stacks actions and metadata. |

Studio's Movie option now states “up to 20 minutes.” The upload helper states MP4/MOV, 500 MB, Movie/Reel duration limits and chunked transfer above 200 MB. The provider-off state still disables upload and states that the draft remains saved. Progress explicitly measures transfer; provider processing and human review still follow. Operations distinguishes the three-minute Reel and twenty-minute Movie caps from expiring quota overrides. Moderation keeps format and actual duration attached to the exact revision and preserves private preview/review boundaries. These are factual extensions of existing controls.

The browser binds the grant to account, revision, protocol and selected-file size. Files through 200,000,000 bytes retain multipart; larger files through 500,000,000 bytes use the server-created private TUS resource. Source shows HEAD followed by sequential 8 MiB PATCH chunks, validated protocol/length/offset/acknowledgment/canonical URL, measured aggregate progress, cancellation and a single bounded transfer deadline. It creates no second resource, automatically retries no uncertain grant/PATCH and stores no capability URL/token/file in the account/revision journal. Reload does not promise automatic resumability. These dynamic behaviors are source and controlled-test evidence; they were not visually exercised against live Stream.

`FilmPlayer` retains explicit play, no autoplay/preload, validated signed iframe origin, one active player and expiry closure. The duration-bound signed window now admits a complete Movie rather than truncating it at five minutes. The attributed component test remains active after 301 seconds and closes at its 990-second grant expiry. Long-player appearance and actual long playback are **source/controlled-test evidence only** in this review. An issued Movie token can remain valid for up to 21 minutes after new grants are denied; that is the existing implementation bound, **not an approved revocation SLA**.

## Preserved design system

`DESIGN.md` and `.impeccable/design.json` remain byte-for-byte unchanged. Read-only counts confirm **46 frontmatter color entries** and **46 sidecar color metadata entries**. No reusable primitive needs recording for this ordinary extension.

| File                      | SHA-256                                                            |
| ------------------------- | ------------------------------------------------------------------ |
| `DESIGN.md`               | `D5CF765D5787B31B983F51668890B3B41CCDDAFBBCEEC269D2ADD17338F02B12` |
| `.impeccable/design.json` | `9FFC819C3726DD7153FCFD09ADE2B96AC0B75B242B3FAC93A1A7C84C71030F9D` |

System summary:

1. Palette: neutral night/day grounds with restrained violet interaction and semantic feedback.
2. Type: DM Sans ordinary headings, controls and metadata; existing responsive hierarchy retained.
3. Display: Cormorant Garamond remains reserved for featured-film titles.
4. Material: flat tonal layers, quiet borders, lightly softened fields and existing focus treatment.
5. Named rules: Honest Accent, Artwork Contrast and Quiet Interface remain authoritative.

Not canonized or repaired: inherited Reels plate/comparison drift, historical documentation drift and open formal method/release gates; this bounded behavioral extension authorizes no system repair or new visual rule.

## Saved evidence and limits

All captures are under `.impeccable/review/full-films/`. The parent and fresh finish reviewer report the actual authenticated disposable creator's current Studio copy and configured-off states, captured at nominal desktop 1440px and phone 390px. This documenter independently read file headers for the dimensions below; capture validity and visual findings remain attributed to the fresh finish review.

| Capture                          | Actual pixels | Coverage                                                                             |
| -------------------------------- | ------------- | ------------------------------------------------------------------------------------ |
| `studio-desktop-dark.png`        | 1430 × 3868   | Full-page desktop, document top present.                                             |
| `studio-mobile-dark.png`         | 380 × 4824    | Full-page phone, document top present.                                               |
| `studio-desktop-dark-detail.png` | 1430 × 993    | Named scrolled desktop viewport; the bottom cut is expected for this detail capture. |

The retained `.png` filenames contain JPEG/JFIF bytes; they are left unchanged. Parent DOM evidence reports phone clientWidth/scrollWidth **380/380**, with no horizontal overflow. The one retained detector result, `detector.json`, is **`[]`**. No detector, browser session, test suite, application code or runtime mutation was performed by this documenter.

The exact functional/live handoff is [[03 Delivery/Full Film Verification]]. Parent evidence records **588 tests / 51 files**, global TypeScript/ESLint/format and production build **40/40 PASS**. Independent verification records **308 tests / 17 files**, eight additional SQL probes and final **ACCEPT**. Local migration 015 was applied without reset, preserving the original Auth hash; the verifier independently read the installed duration/entitlement bounds. These are attributed results, not reruns by this documentation pass.

Independent read-only MP4 metadata checks found THE CALL at **158,829,024 bytes / 736.979 seconds** (737 rounded; multipart) and TARU at **329,742,172 bytes / 929.844 seconds** (930 rounded; TUS). Both fit Movies. Neither original has been uploaded, trimmed, transcoded or modified. Default three uploads/day and 1,800 seconds/month remain: process/reconcile THE CALL before reserving TARU so the first unused hold is released. Permission attestation and container metadata do not establish independent licensing review or full decoding.

The independent SELECT-only cleanup record confirms zero fixture rows across **29 exact-ID scopes**, original accounts and **nine baseline hashes** preserved, and disposable credential material removed. Existing viewer remains signed in. Browser fixtures were synthetic and removed.

Stream remains unconfigured, uploads disabled, and the read-only provider check still returns **403 Authorization Failure**. Actual TUS binary/CORS behavior, provider processing/reconciliation, private video review, guest long-film playback, activity delivery and external deletion remain live gates. Hosted identity, exhaustive accessibility/performance/cross-browser and overall release are also open. The scoped finish disposition for the two documentation fixes closes none of these gates.
