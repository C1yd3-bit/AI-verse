# Full-film support

[[Home]] · [[03 Delivery/Roadmap|Roadmap]] · [[02 Architecture/Media Provider|Media provider]] · [[04 Operations/Runbook|Runbook]] · [[03 Delivery/Full Film Design Review|Design review]]

2026-10-25. The user supplied two local MP4 films, confirmed permission to upload/distribute both and explicitly chose **full-film support**. The local implementation is independently **ACCEPT**. Neither film has been uploaded, published, trimmed or transcoded. Stream access and application credentials remain unconfigured; live media verification is still open.

## Current policy

| Boundary      | Implemented rule                                                                                                 |
| ------------- | ---------------------------------------------------------------------------------------------------------------- |
| Movies        | Maximum1200seconds/20minutes;500000000bytes/500MB                                                                |
| Reels         | Maximum180seconds/3minutes; unchanged                                                                            |
| Transfer      | Multipart through200000000bytes; larger files use private TUS                                                    |
| Creator quota | Three uploads/day,1800seconds/month by default; existing audited overrides remain                                |
| Reservations  | Immutable server-owned revision format chooses duration cap, bounded by remaining monthly quota; no quota bypass |
| Playback      | Verified duration plus60seconds, minimum60; Movie maximum1260seconds, Reels maximum300                           |

Independent MP4 movie-header reads confirm THE CALL is158829024bytes/736.979seconds, rounded737; TARU is329742172bytes/929.844seconds, rounded930. Both fit Movies. THE CALL uses multipart and TARU uses TUS. This is a user rights attestation plus container-metadata check, not independent licensing review or a full media decode.

Upload sequentially under the unchanged quota: THE CALL initially reserves1200seconds. Wait for actual provider processing/reconciliation to charge737 and release the unused hold. TARU can then reserve1063seconds and charge930, leaving133seconds in that month's default allowance. Starting both reservations before reconciliation would leave only600seconds for the second film. A reservation allowance can therefore be lower than the headline20-minute maximum; never bypass it or repeatedly request grants.

## Implemented boundaries

- New shared media policy owns application duration, file-size, protocol and signed-window caps. The HTTP upload request requires a bounded file size; its response echoes account, revision, protocol and size. The browser binds those to the selected file. Private provider identifiers remain absent from the public grant.
- Large-file creation uses Cloudflare's server-authenticated TUS direct-user endpoint, with fixed maximum duration, expiry, signed-only playback, creator and immutable operation metadata. The201 response supplies a separately validated media ID and canonical opaque upload Location. No ID is inferred from the TUS URL; credentials never enter the browser. Ambiguous provisioning retains existing lease/recovery behavior.
- The browser continues the already-created resource with HEAD and sequential8MiB PATCH requests, never another creation POST. It verifies TUS1.0.0, total length, safe integer offsets, exact chunk acknowledgments, status and canonical response URL. Native XHR reports measured aggregate progress; omitted credentials, no-referrer, cancellation and a single grant/fifteen-minute deadline bound transfer. Invalid/uncertain outcomes do not automatically retry a grant or PATCH. The account/revision journal contains identifiers only, and no reload-resume promise is made.
- Migration015 derives Movie/Reel duration from immutable metadata, conservatively reserves remaining quota and independently rejects overlong Reel provider callbacks. Reconciliation, private review, publication, signed entitlement, session admission and activity constraints admit actual long films without allowing creator, owner, publication or hidden/suspended boundaries to be bypassed.
- Player/API/activity schemas accept Movies through1200seconds; signed windows are no longer truncated at300seconds. The actual FilmPlayer test remains active after301seconds and closes at its990-second grant expiry. Unique observed-range tracking remains seek-resistant and daily-deduplicated. Published discovery/detail retains930-second Movies and excludes them from the dedicated Reels schema.

Cloudflare's primary references: [direct creator uploads](https://developers.cloudflare.com/stream/uploading-videos/direct-creator-uploads/), [large-file/chunk constraints](https://developers.cloudflare.com/stream/uploading-videos/resumable-uploads/), [TUS protocol](https://tus.io/protocols/resumable-upload). Runtime/CORS/response behavior still requires actual configured service verification; documentation and injected responses are not live evidence.

## Evidence

| Layer                  | Result                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Parent complete suite  | **588 tests/51 files PASS**, global TypeScript/ESLint/format and unchanged production build40/40 PASS                                                                                                                                                                                                                                                      |
| Independent verifier   | **308 tests/17 files PASS**, global TypeScript, scoped lint/format and eight additional all-migration SQL probes; final ACCEPT                                                                                                                                                                                                                             |
| Independent SQL probes | Sequential737/930 consumption and holds, remaining/daily quotas, cross-owner denial, private long-film preview,990-second entitlement, over-duration/monotonic/seek/takedown/session/privilege denials, Reel180 acceptance/181 denial                                                                                                                      |
| Local Supabase         | Migration015 plus exact history applied transactionally with no reset; original Auth hash/count preserved. Verifier independently read installed1200/1260 bounds. No hosted change.                                                                                                                                                                        |
| Browser                | Disposable local creator's actual Studio displays Movie20minutes,500MB and chunked-transfer guidance; provider-off controls remain disabled. Full-page desktop1440/phone390 captures have document tops; phone DOM clientWidth/scrollWidth380/380. Existing layout/theme rules unchanged. Dynamic large-file upload remains controlled-test evidence only. |
| Mechanical UI          | One detector on changed TSX returns zero findings. Fresh finish/documentation evidence belongs to [[03 Delivery/Full Film Design Review]]. Historical Reels plate/DRIFT and overall method/release gates remain open.                                                                                                                                      |
| Cleanup                | Two disposable personas, three synthetic films/revisions and dependent data removed. SELECT-only independent checker finds zero rows across29 exact-ID scopes, preserves original account IDs/nine baseline hashes, and confirms fixture credentials absent. Existing viewer remains signed in; original MP4 files untouched.                              |

Evidence directory: `.impeccable/review/full-films/`. Files include `independent-verification.json`, `verifier-tests.json`, `verifier-probe.mjs/json`, `migration-evidence.json`, `fixture-evidence.json`, `independent-cleanup.json`, `detector.json`, `studio-desktop-dark.png`, `studio-mobile-dark.png` and the deliberately scrolled `studio-desktop-dark-detail.png`. Browser fixtures are explicitly synthetic and have been removed.

## Remaining live gate

Both supplied files pass the new preflight size/extension/permission check; independently read durations fit Movies. Overall preflight remains `ready:false` because Stream account/token, upload flag, worker reconciliation and deliberate live-catalog mode are absent. A read-only storage-usage request still returns403 Authorization Failure. Prior token decline remains authoritative; no billing plan, credential, provider asset, webhook, environment activation or public deployment was created.

The user must activate/authorize Stream and test costs, then authorize/configure server-only application access. Use an approved creator and separate reviewer for actual uploads; do not elevate the retained viewer silently. Then upload/process/reconcile one film before the other, review each exact file and metadata, publish, verify guest playback and actual activity, and exercise removal/provider cleanup. No auto-publication is implied by permission to upload.

Long-film windows have a material removal tradeoff: new grants stop after hide/removal, while an already issued Movie token can last up to21minutes. Existing segments/cache and interruption need real measurement. This is an implementation bound, not an approved revocation SLA. Hosted identity, real CORS/TUS/binary processing, player delivery, external deletion, exhaustive accessibility/performance/cross-browser and overall release remain unverified.
