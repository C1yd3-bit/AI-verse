# Reels viewing and playback activity

## Scope and approval

User authorized immersive reel viewing and playback activity. Preserve the portrait browsing grid and existing identity. Local Supabase remains active; Stream stays unconfigured.

User selected native mock B at1505x1045. Plan/asset round2 approved four items and requested next-art revision: “in the comp emphasize the key object”. The revised image brings the couple forward; its exact prompt is embedded and recorded in its sidecar. Round3 receipt revision `3bda4bcc44acf1742608741d4e16406c0cffca4bd9ee84903d4fb26baa4b093e` approves all five items and confirms inventory.

User explicitly resolved image similarity: “Use B’s layout and my approved artwork; the mock’s artwork is reference only”. Layout remains binding. Installed CLI still refuses its image gate/force despite the actual approval. Preserve raw readings: kitten structure34%; revised next-preview structure17%, combined26%. No numeric match or automated phase pass is claimed. Previous profile ledger is preserved in `.impeccable/history/reels-viewer-start/prior-build`. Native mock generation preceded this installed CLI's spec start because it requires an existing comp; no missing history was fabricated.

## Backend and tracking

Migration013 adds private service-issued sessions bound to verified owner, exact public version, trusted duration and expiry. Only actual successful public playback grants may open them. Guest/private-review playback produces no account activity. Same-origin progress requires matching verified identity and strict bounded input; arbitrary, cross-owner, expired, hidden/suspended/revised and implausible updates fail.

Progress is monotonic and retry-safe. Partial activity can later reach90% credit, once per owner/video/UTC day. Existing aggregates and recommendations reuse these retained records. A reproduced receipt-jitter false rejection was fixed using total elapsed admission time plus two seconds of total slack, without granting fresh allowance per retry.

The lazy SDK tracks unique observed ranges after actual playing events, with seek/replay/wall-time guards and lifecycle cleanup. Native controls survive SDK failure. Signals are not proof of attention or public views. Integration follows the [official Stream Player API](https://developers.cloudflare.com/stream/viewing-videos/using-the-stream-player/using-the-player-api/); real Stream behavior remains unverified.

## Evidence so far

- Independent backend/core ACCEPT:83 tests/six files plus TypeScript; receipt-jitter reproduction corrected.
- Independent actual FilmPlayer/data followup ACCEPT:77 targeted tests/four files plus TypeScript. Mocked hooks/SDK/HTTP and PGlite do not prove provider operation.
- Migration013 applied transactionally to healthy local `aiverse-ana`, with exact SQL history and schema notification; no reset.
- Real PostgreSQL rollback-only probe passed privileges, partial-to-credit progression, retry deduplication, legacy bypass, cross-owner and hidden-video denial. All synthetic accounts, roles and content rolled back. Existing account count1, session count0 preserved.
- Six actual guest HTTP checks passed: Reels/catalog200, configured-off playback503, demo-id404, unauthenticated progress401 and wrong-origin403; API no-store preserved. No provider I/O.

## Viewer and final evidence

- [x] Preserve portrait browsing and add the selected B viewer with explicit playback, scoped vertical navigation, shareable history, details/search and validated Load more. Only exact published reel records enter its bounded queue.
- [x] Real browser checks cover Next/Previous, focused Up/Down, vertical wheel navigation, queryless-link Next/Back, filtered-grid open/return, dark/light and truthful end states. Requested phone390px renders an actual380px DOM/380x822 capture; desktop1505x1045 and medium885x900 also have no horizontal overflow. Phone controls measure44px wide. Real touchscreen hardware and actual Stream footage were not tested.
- [x] First bounded visual pass found soft decoded images, kitten crop, medium-toolbar overlap and focus loss at disabled boundaries. One batch corrected all four; final confirmation captures are valid. No further visual polishing was added.
- [x] Independent final functional ACCEPT:108 targeted tests/five files, TypeScript and scoped ESLint. The verifier independently reproduced a queryless Back defect; canonical query/paging comparison repaired it, including seven new regressions and an unchanged independent scratch reproduction. Parent repeated the actual browser reproduction successfully.
- [x] Final full suite:370 tests/37 files PASS. Global TypeScript, ESLint and formatting PASS after the history correction. Unchanged `npm run build` / `next build` passes with40/40 generated pages. Initial Turbopack worker-startup failures cleared after moving only production cache/output into the local work backup and rerunning with local worker access; the development preview was preserved. Precise underlying cause is unproved; no dependency, script or framework configuration workaround was introduced.
- [x] Fresh finish reviewed all six final captures: implemented visual matrix passes with no outstanding UI repair. Exact disposition **FIX**, method persistence only. Current `hero-repro.png` and `diff/report.json` compare B to this viewer: raw74.47% DRIFT, structure85.34%, color52.96%, default threshold unchanged. Evidence-only confirmation resolves missing current comparison inputs; formal CLI phase closure remains open. `build-phase finish --disposition fix` recorded the review word while truthfully retaining the plates phase open. `comparison-output.json` preserves actual tool output; this CLI did not emit a separate raw-report file.
- [x] One detector run:4 advisory/0 nonadvisory findings, all scoped type/radius choices. [[03 Delivery/Reels Design System Check]] records the ordinary-extension comparison, actual geometry, assets and unchanged DESIGN/sidecar hashes;46 incumbent colors preserved.

The five authenticated HTTP negative cases additionally passed with a separate helper session for the existing local viewer: session issuance required403, account comparison409, strict input400, duration bound400, wrong origin403. The helper signed out only its own session with local scope; the actual browser remains signed in and original Dark appearance is restored.

Licensed upload/processing/review/playback, hosted identity, policy and overall release remain separate open gates in [[03 Delivery/Release Checklist]].
