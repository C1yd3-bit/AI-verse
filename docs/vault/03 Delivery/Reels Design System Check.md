# Reels design system check

[[03 Delivery/Roadmap]] · [[03 Delivery/Discovery Assistant Review]] · [[02 Architecture/Decisions]]

2026-10-25. Bounded documenter comparison of the implemented immersive reel viewer with the incumbent design system. This is an ordinary component extension, not a new visual world or an approved global redesign. Result: **compatible local extension; global design files preserved**, with the documentation scope mismatches below recorded explicitly.

## Authority and evidence

Product truth: `PRODUCT.md`. Incumbent visual rules: `DESIGN.md` and `.impeccable/design.json`. Composition and behavior: `.impeccable/surface-reel-viewer.md`, including THESIS, OWN-WORLD, STORY, FIRST VIEWPORT and FORM. The user selected B, approved the plan and all five asset inventory items in round3, then explicitly instructed: “Use B’s layout and my approved artwork; the mock’s artwork is reference only”. This does not establish a numeric image-similarity pass.

Source sampled: `src/app/reels/viewer.css`, `src/components/reel-viewer.tsx`, `src/components/app-shell.tsx`, `src/components/catalog.tsx`, and shared focus, rail, font and reduced-motion rules in `src/app/globals.css`. Opened and visually inspected the current desktop-light and mobile-light captures under `.impeccable/review/reel-viewer/`. Other runtime checks and the pending final dark captures remain the parent verifier’s evidence; this pass does not claim independent browser execution or a live Stream test.

## Shipped geometry and typography

- The desktop viewer occupies `100dvh`, with a 500px minimum and a dedicated contained vertical scroll region. Its portrait stage is 9:16. Width is the minimum of 480px, `(100dvh - 176px) * .5625`, and the workspace width after the existing rail and 160px allowance. The centered composition adds a 72px navigation track and 48px gap; top padding is 20px.
- Between 701px and 1100px, the stage height allowance becomes 228px and composition top padding becomes 72px, making room for the toolbar. The existing 1050px rail change remains inherited rather than replaced.
- At 700px and below, the stage width is the minimum of `100vw - 80px` and `(100dvh - 260px) * .5625`. Viewer height is `100dvh - 131px`, minimum 420px. A 44px navigation track, 12px gap and 56px composition top padding preserve visible vertical controls. The existing mobile shell keeps labeled navigation and the account link.
- The stage has 12px corners on desktop and 10px on mobile; the next-art peek has 10px corners and a 240px desktop/160px mobile height. These are local silhouettes, not additions to the global radius scale. The next preview is an image button, never a second playing video.
- DM Sans Variable is inherited throughout. The film heading is 32px/1.2, weight600, tracking -.025em, becoming 24px/1.2 on mobile. Metadata is 15px/1.5, becoming 13px; disclosure is 13px/1.5, becoming 12px. Navigation labels are 14px desktop/11px phone; the scroll hint is 14px/12px. No new font import or global type role is added. The viewer’s ordinary sans-serif film heading does not change the Home featured-film serif rule.
- Caption padding is 160px 21px 28px, reduced to 120px 16px 20px on mobile. A transparent-to-dark gradient separates text from the image. Text balances and wraps; no text, navigation or metrics are baked into artwork.

## Theme, focus and motion

Outer controls and surfaces use the incumbent semantic variables: muted/text, accent, navigation-selected, secondary-hover, surface, line and error. Light appearance changes the shell and controls through those same mappings. The stage locally pins ten existing dark token values for readable artwork captions and playback feedback in either theme. These are exact reused dark values, not a new palette. Desktop-light and mobile-light captures show light surrounding UI with pale text over the dark caption gradient.

There is no box shadow. Depth comes from the image, a caption gradient, quiet borders and semantic tonal states. Search is a circular 46px control on desktop/44px phone. Previous/Next buttons are 72px wide and at least84px tall on desktop; phone controls are 44px wide and at least66px tall. Their visible circular arrows are 62px desktop/44px phone. The active border uses accent; disabled navigation uses opacity .38 and the inherited disabled cursor.

Links and buttons inherit the shared 2px accent focus outline with 4px offset. The focusable viewer region instead has a local 1px accent outline with -3px offset. Back and detail actions retain 44px minimum height. The stage arrival animates opacity .96→1, vertical translation6px→0 and a 2px top clip over .24s with `cubic-bezier(.16,1,.3,1)`. Arrow hover background transitions over .15s ease-out. Local and global reduced-motion rules remove these effects; global document scrolling becomes automatic rather than smooth.

## Semantic and accessibility evidence

The toolbar uses real Back and Search links. The dedicated region is keyboard focusable, named and described by visible guidance. Navigation uses labeled native buttons with real disabled states. Active reel changes are announced through a polite live status. Artwork has descriptive alternate text; the next-preview image is decorative inside a button named with the destination title. Icons are Lucide SVGs hidden from assistive technology.

ArrowUp/ArrowDown navigation is scoped to the viewer and excludes typing fields, links, buttons, dialogs and the embedded playback subtree. Wheel and touch gestures use the dedicated region and do not auto-start adjacent playback. Moving a reel returns focus to the region, avoiding focus loss when a navigation button becomes disabled. End, loading and recoverable error states use native text and controls, with errors announced as alerts. These statements describe source behavior; touchscreen operation and screen-reader output were not independently executed by this documenter.

The scoped AppShell branch retains the incumbent rail, marks Reels current for nested routes, and removes the ordinary search/assistant topbar and footer only inside the immersive route. A small Search action replaces that topbar there. The portrait browse grid remains intact; only exact-result links with a viewer context enter the new route. FilmPlayer is mounted once for the active live item, while demo mode shows “Sample artwork · No video attached.” There are no pretend playback controls or fabricated viewing counts.

## Asset provenance

- `assets/plates/kitten-art.png`: 1698×926; pre-existing cat artwork pixels, with embedded `impeccable:prompt` origin metadata. SHA256 `a59726020b888cf263ed57c6bc4166b0f781a1b11c7b8c9c62ce2a81668ee227`. Its viewer crop uses 35% center; the original catalog image remains separate.
- `assets/plates/next-art.png`: 2172×724; image-generation edit of `public/artwork/midnight-v2.png`, revised after the user asked to emphasize the key subjects. Both umbrella-carrying adults are enlarged for the shallow next-preview. The PNG contains embedded `impeccable:prompt`; the exact edit prompt, source and feedback are also in `assets/plates/next-art.png.json`. SHA256 `2a8d2e23b2a1e6535d9119d19dedff5c7724e85d526918460dc196e6ba4506d6`.

The parent aligned the next-art generation sidecar with the later submitted round3 inventory: `approved:true`, review revision `3bda4bcc44acf1742608741d4e16406c0cffca4bd9ee84903d4fb26baa4b093e`, and the user's explicit artwork instruction. The exact edit prompt and PNG bytes remain unchanged. This records actual approval rather than a numeric image-gate pass. The revised asset is used only for the next-reel peek; the active Midnight reel retains its incumbent artwork. Raster metadata presence and dimensions were inspected directly from PNG chunks; no new image was generated in this documentation pass.

## Incumbent comparison and preserved files

All existing primitives remain unchanged: **46 colors,21 typography roles,7 rounded entries,14 spacing entries and33 frontmatter component entries**. The schemaVersion2 sidecar still has46 color-metadata entries,14 preview components and4 recorded global breakpoints. Viewer-local measurements, circles, radii, animation and its701–1100px adaptation are documented here rather than promoted into reusable global norms.

Preserved SHA256 values:

- `DESIGN.md`: `d5cf765d5787b31b983f51668890b3b41ccddafbbceec269d2add17338f02b12`.
- `.impeccable/design.json`: `9ffc819c3726dd7153fcfd09ade2b96ac0b75b242b3fac93a1a7c84c71030f9d`.

Scope mismatches deliberately not repaired: the incumbent general layout sentence “No carousel, swipe rail, or auto-advance is implemented” predates this dedicated vertical viewer; its shared-footer sentence names only the earlier profile exception; its shape description covers landscape catalog cards rather than the new portrait stage. Read these as descriptions of prior surfaces, not prohibitions on the user-approved viewer. The sidecar’s pre-existing overview string ends with a partial “Key Characteristics” fragment. None of these authorizes replacing the world or regenerating global files during this ordinary extension.

Not canonized: the viewer’s local geometry/type sizes, clip animation, navigation circles and pinned artwork scope are not universal defaults. No craft-floor refusal was promoted into the system. No provider playback, numeric image-gate success, whole-project SHIP, formal CLI completion or release acceptance is inferred from this report. The historical profile ledger remains at `.impeccable/history/reels-viewer-start/prior-build`; the user’s artwork authority does not fabricate an installed-CLI gate pass.

Documenter outcome: **compatible scoped extension, with recorded documentation scope drift; DESIGN.md and its sidecar unchanged**. This note is the sole file written by this pass.
