# Published catalog and GitHub source release

[[Home]] · [[03 Delivery/Roadmap|Roadmap]] · [[03 Delivery/Published Catalog Design Review|Design review]] · [[03 Delivery/Release Checklist|Release checklist]]

2026-10-25. The user explicitly requested removal of runtime mock data and source publication to the existing public repository [C1yd3-bit/AI-verse](https://github.com/C1yd3-bit/AI-verse). GitHub CLI metadata confirms an empty public repository and the active C1yd3-bit account's push permission. This authorizes source publication, not app deployment, provider activation or billing.

## Runtime changes

- Discovery always reads the anonymous published database projection/RPC; legacy demo environment values cannot restore sample records. Empty data stays empty and unavailable/malformed/network responses show explicit recovery states or API503, not fabricated films.
- Home has no sample hero/cards. Browse/detail/creator/tag pages use published content; retired sample permalinks are not found. Film results and Reels use metadata-supplied covers, with no hardcoded sample plates/crops.
- Authentication preserves the approved split structure, using at most four public approved cover projections when present. No covers or catalog failure gives a quiet brand/purpose panel; account access remains available. Failed/revoked images fall back safely, one image omits redundant controls, and multiple real covers retain native controls/reduced-motion/visibility/focus handling.
- Sample metadata/search helpers live under `tests/fixtures` only. Served sample artwork files were archived outside the repository. The old demo browser-preference/WatchLater modules and obsolete test were removed; account interests use the authenticated API. No existing user/database record was deleted.
- The seed is taxonomy only. `.env.example` and CI use real-account/published semantics, with provider uploads still disabled. The preflight no longer requires an obsolete catalog-mode flag.

## Local verification

Parent complete suite: **603 tests/51 files**, TypeScript, ESLint, formatting and unchanged production build40/40 PASS. Independent functional review: **88 tests/seven files**, TypeScript,30 read-only HTTP checks, six retired-artwork404s and an actual anonymous empty published catalog PASS. Regression coverage includes unset/demo/live/invalid legacy flags, no fallback on service failure, no fake hero/cards, invalid/retired IDs, actual public projection enforcement and auth cover filtering/failure.

Four final document-top desktop/phone captures show Home and Auth with zero sample images and readable empty states. The initial Auth phone capture incorrectly used a desktop viewport and was replaced before independent full re-review. Actual phone DOM widths equal scroll widths. Email form controls still open normally; the retained local viewer remains signed in. Populated live-video delivery and new light-theme/assistive-technology behavior are not inferred from empty-state screenshots.

The single detector finds14 advisories and zero primary findings, principally inherited auth type/radius literals. The fresh finish and ordinary-extension source comparison are recorded in [[03 Delivery/Published Catalog Design Review]]. Visual primitives remain unchanged; DESIGN.md and the sidecar narrative now explicitly mark obsolete demo guidance historical and superseded by published-only/account-backed content rules. The fresh reviewer scored this single persistence fix resolved with ship for that fix only; prior formal plates/DRIFT and overall release gates stay open.

No SQL migration/reset, database/account change, environment-secret change or provider call occurred. A SELECT-only preservation checker confirms all nine original viewer data hashes unchanged,29 old fixture scopes empty and disposable credentials absent. The original local MP4 files remain untouched and are not part of Git.

## Public source boundary

Only reviewed UTF-8 text source/configuration, lockfile, migrations/taxonomy, deterministic tests, agent definitions and documentation are eligible. Exclusions include `.env*` except the empty template, dependencies/build output, local Supabase state, private JSON, downloaded videos, sample artwork, account/provider screenshots, design mock binaries and local review/history/question artifacts. Public setup examples use placeholders rather than actual personal project identifiers and machine paths. Historical design/source notes remain historical documentation and cannot seed runtime data.

The GitHub connector's attempted initial README write was rejected with403 Resource not accessible by integration; no remote commit was created. A restricted CLI probe also reported invalid credentials. With network/keyring access, `gh auth status` verifies the active C1yd3-bit login and repo/workflow scopes. The user selected the CLI route. Publication will use a local reviewed initial main commit and a normal push to the verified empty repository, with no force push. Remote tree paths/blob hashes and branch head must be verified before recording publication success.

The workflow has read-only permissions, no secrets and no deployment. Both official `actions/checkout@v7` and `actions/setup-node@v7` tag refs were verified through GitHub's API. A successful local run or published workflow is not proof of remote CI completion.

## Publication result

Source publication and final remote verification are pending. Stream remains unconfigured; neither supplied film is uploaded or published. Hosting, actual Stream/CORS/playback/deletion, hosted identity, policy/rights review, performance/accessibility and overall public app launch remain open.
