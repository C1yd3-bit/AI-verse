# Ask AIVerse discovery assistant

[[03 Delivery/Roadmap]] · [[02 Architecture/Decisions]] · [[03 Delivery/Minimal Profile Review]]

2026-10-25. User approved the local rule-based discovery helper and selected **A — side drawer** from three image previews. Approved image and prompt/approval sidecar: `.impeccable/mocks/assistant/option-a.png`. B/C remain unselected. Existing Home, typography, colors and artwork are inherited; the assistant extends the current search experience.

## Behavior

- Ask AIVerse opens beside the shared search on non-auth pages, including Home, Search and Reels. The native modal is about440px wide on desktop and full-width on phones. One scroll area holds conversation/results; the composer remains at the bottom. Escape closes and returns focus, New search resets, and Stop/Retry preserve recoverable context.
- Initial requests map to visible keyword, content-inspiration, genre, format, language, hashtag and numeric duration filters. Follow-ups replace the mentioned dimension while retaining others. Examples: `Shorter`, `More comedy`, `In Tagalog`, `no length limit`, `any genre`, `any inspiration`, `any language`, `all formats`, `clear keywords` and `reset`. Durations use numbers, e.g. `under 2 minutes`.
- “More like this” derives filters from a server-resolved published source, excludes that source and adjusts its total. Missing/private sources clarify. Unsupported negations and mixed similarity/refinement requests clarify without silently changing filters. This bounded parser is not a general conversational LLM.
- Responses show at most three exact and two distinctly labeled broader results, with real metadata, detail links, canonical search/Fusion links and honest empty states. Broader suggestions relax content inspiration/genre while retaining other filters. Current demo artwork never claims playback.
- Signed-in users can save the current mix through existing owner-derived RPCs. The assistant's save variant supplies a comparison-only account header, which the server checks before mutation. Legacy callers remain supported. Every accepted turn remounts its save form, including beyond the eight-turn conversation cap.

## Boundaries

`POST /api/assistant` accepts strict, bounded JSON (8192 streamed bytes): a 1–500-character message, optional validated current query and optional safe reference ID. Same-origin requests can discover as guests. Retrieval reuses the existing public-only discovery service; live failures return503 without demo fallback. Runtime response validation rejects nonpublished/private fields, external artwork/URLs, duplicate cards and inconsistent visible totals.

No chat storage, private preference/ethnicity inference, paid AI, embeddings, new SQL, provider setup or environment changes. Only the last eight turns stay in component memory. Abort/generation guards ignore stale replies after Stop, reset, navigation, unmount and account boundaries. Confirmed account loss clears the prior chat/draft; ordinary pending identity refresh and repeated guest checks preserve them. The shared provider signals actual401/403 only, ignoring aborted stale reads.

## Verification

- Independent backend **ACCEPT**: 43 targeted tests/six files, typecheck/lint and additional parser/response probes. Required comparator, incidental-any, negation and mixed-similarity defects were repaired and reverified.
- Independent UI functional **ACCEPT**: 27 targeted tests/three files plus actual-component lifecycle probes. Confirmed-account-loss and ninth-turn save-state defects were repaired and reverified. Stop/reset/retry/late replies, navigation/account resets and provider-event suppression passed these probes.
- Parent full suite: **226 tests across30 files PASS**, full ESLint and formatting PASS, production build **40 pages PASS**. No remote CI or release acceptance inferred.
- Actual guest HTTP: search/refine/reset/public similarity, hidden-source denial, strict unknown fields/message/body/filter bounds, origin denial, private/no-store responses and canonical Fusion URLs pass. No account or external provider request occurred in that script.
- Parent browser: classic search still works; cat request returns the existing cat film; Korean romance/reels under2minutes shows strict119-second chips, no exact match and a labeled broader result; removing the length limit finds Midnight; Tagalog refinement preserves keywords and returns empty. Enter sends, Shift+Enter inserts a newline, native modal and Close→New-search Tab behavior are observed, Escape returns launcher focus/body scroll. No stronger browser-chrome focus-loop claim is made.
- Actual signed-in save returned success; Library showed the synthetic mix and reopened its exact canonical Fusion filters. Exactly that test mix was removed from the dedicated local database. Existing viewer/account/session and other records remain intact.
- Detail links reach the real demo film page, and Reels exposes the launcher. Dark/light and 1440/885/390 CSS widths were inspected without horizontal overflow; the phone composer ends at844px in an844px viewport. Light was restored to Dark. No real touchscreen, mobile keyboard or offline-browser simulation is claimed; pending/error/retry behavior has source/lifecycle test coverage.

## Implemented design documentation

DESIGN.md and its sidecar now record the approved A component extension against actual assistant.css/DiscoveryAssistant source. All 46 existing dark/light palette entries and prior typography/shape/spacing/component primitives are preserved. Assistant-local roles cover the 23px welcome, 18px film-title link and 10px footnote; other copy inherits the existing DM Sans system. The asymmetric message bubble uses 12px corners with a 3px lower-right corner; recognized filters/refinement controls use 999px pills. The 44px circular send/stop control, base-radius composer/artwork and square drawer remain local rules. The previous search-only pill restriction is reconciled only for these user-approved assistant exceptions.

The component-local backdrop is rgb(0 0 0 / 0.36), not a new global palette entry. Documentation also records the 440px/100dvh drawer, full-width phone breakpoint at 700px, safe-area padding, one flexible scroll region and anchored composer, native modal/close focus behavior, shared 2px focus outlines (textarea offset 3px), and reduced-motion removal of the 0.25s/28px entry animation. Sidecar includes a self-contained ds-prefixed style preview and technical behavior metadata.

## Visual evidence and remaining review

Nine opened captures under `.impeccable/review/assistant/`: initial-desktop, exact-desktop, broader-desktop, exact-medium, empty-mobile, exact-mobile, exact-mobile-light, details-mobile-light and reels-entry-mobile. Desktop1440×1000, medium885×887, phone390×844 requested; actual exported PNG dimensions are recorded by the fresh reviewer. Detail capture was named after its actual rendered destination; the settled Reels capture is separate.

One persisted detector run reports **8 advisory /0 nonadvisory** findings for local type/radii/backdrop choices. No second detector run. The three preview images retain exact embedded prompts and sidecars; no new decorative raster ships in the app.

Fresh finish initially returned **FIX** with three required follow-ups and no visual-design repairs. The same reviewer subsequently scored **all three resolved**, found no regressions in the batch and returned **SHIP for the scored fixes only**. This does not award whole-surface method or release acceptance.

Assistant-scoped `regions.json`, DOM measurements, map inspection, `Measured Comparison.md` and `phase-status.json` retain the actual evidence. Nineteen assistant regions inspected with zero map errors; full-spec admission refused uncovered contextual Home, without an override. The whole-frame unmasked comparison reports **66.54% drift**, with side-by-side/heatmap retained and opened. Formal completion remains explicitly false; the historical profile-C ledger was not reset or replaced. No QUALITY BAR card or complete assistant CLI phase history is claimed.

The corrected similarity capture is the tenth browser image, `similarity-corrected-desktop.png`: Global produces “shared genre and format” without claiming content-inspiration matching. The six affected service tests and final 40-page build pass after this correction. DESIGN/sidecar validation passed YAML/JSON, schema, 124 token references, all46 earlier colors/primitives and scoped formatting. This addition's explicit image selection is recorded, while earlier artwork, formal method, provider/player, hosted identity, policy and overall release gates remain open.
