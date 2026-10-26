---
name: AIVerse
description: A cinematic, honest discovery interface for AI-created entertainment.
colors:
  ground: "#0c0d10"
  surface: "#14151d"
  input: "#1b1c27"
  line: "#333542"
  text: "#f5f3fa"
  muted: "#b5b7ca"
  accent: "#bda9ff"
  accent-ink: "#211630"
  error: "#ffb0b5"
  success: "#b8e5cd"
  primary-hover: "#d0c1ff"
  secondary: "#242432"
  secondary-hover: "#313143"
  rail-ground: "#0b0c10"
  rail-line: "#2b2c35"
  navigation-hover: "#1b1b27"
  navigation-selected: "#28263e"
  topbar-line: "#20212a"
  field-line: "#393c50"
  search-ground: "#181923"
  placeholder: "#b2b3c6"
  choice-selected: "#29223d"
  choice-selected-text: "#e3d8ff"
  light-ground: "#f6f5fa"
  light-surface: "#ffffff"
  light-input: "#f2f0f7"
  light-line: "#d6d0e1"
  light-text: "#211b2b"
  light-muted: "#62596e"
  light-accent: "#6440af"
  light-accent-ink: "#ffffff"
  light-error: "#a72c43"
  light-success: "#246441"
  light-rail-ground: "#fbfaff"
  light-rail-line: "#ddd7e7"
  light-navigation-hover: "#eeeaf5"
  light-navigation-selected: "#e9e0f8"
  light-topbar-line: "#ddd7e7"
  light-field-line: "#8e819e"
  light-search-ground: "#ffffff"
  light-placeholder: "#62596e"
  light-primary-hover: "#543198"
  light-secondary: "#eae5f3"
  light-secondary-hover: "#ddd5eb"
  light-choice-selected: "#e9e0f8"
  light-choice-selected-text: "#482579"
typography:
  display:
    fontFamily: "'Cormorant Garamond', serif"
    fontSize: "46px"
    fontWeight: 400
    lineHeight: 1.1
    letterSpacing: "-.015em"
  headline:
    fontFamily: "'DM Sans Variable', sans-serif"
    fontSize: "38px"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "-.025em"
  title:
    fontFamily: "'DM Sans Variable', sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: "-.015em"
  body:
    fontFamily: "'DM Sans Variable', sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "'DM Sans Variable', sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
  profile-headline:
    fontFamily: "'DM Sans Variable', sans-serif"
    fontSize: "28px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-.025em"
  profile-headline-mobile:
    fontFamily: "'DM Sans Variable', sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-.025em"
  profile-section:
    fontFamily: "'DM Sans Variable', sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-.015em"
  profile-name:
    fontFamily: "'DM Sans Variable', sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
  profile-name-mobile:
    fontFamily: "'DM Sans Variable', sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  profile-list-title:
    fontFamily: "'DM Sans Variable', sans-serif"
    fontSize: "16px"
    fontWeight: 500
    lineHeight: 1.5
  profile-content-title:
    fontFamily: "'DM Sans Variable', sans-serif"
    fontSize: "15px"
    fontWeight: 500
    lineHeight: 1.5
  profile-total:
    fontFamily: "'DM Sans Variable', sans-serif"
    fontSize: "22px"
    fontWeight: 500
    lineHeight: 1.5
  profile-description:
    fontFamily: "'DM Sans Variable', sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.6
  profile-support:
    fontFamily: "'DM Sans Variable', sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
  profile-label:
    fontFamily: "'DM Sans Variable', sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  profile-initials:
    fontFamily: "'DM Sans Variable', sans-serif"
    fontSize: "24px"
    fontWeight: 400
    lineHeight: 1
  profile-initials-mobile:
    fontFamily: "'DM Sans Variable', sans-serif"
    fontSize: "22px"
    fontWeight: 400
    lineHeight: 1
  assistant-welcome:
    fontFamily: "'DM Sans Variable', sans-serif"
    fontSize: "23px"
    fontWeight: 500
    lineHeight: 1.5
  assistant-film-title:
    fontFamily: "'DM Sans Variable', sans-serif"
    fontSize: "18px"
    fontWeight: 500
    lineHeight: 1.5
  assistant-footnote:
    fontFamily: "'DM Sans Variable', sans-serif"
    fontSize: "10px"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  sm: "5px"
  base: "6px"
  empty-state: "8px"
  initials: "50%"
  search-pill: "9999px"
  assistant-message: "12px 12px 3px 12px"
  assistant-pill: "999px"
spacing:
  px-8: "8px"
  px-10: "10px"
  px-12: "12px"
  px-14: "14px"
  px-16: "16px"
  px-18: "18px"
  px-20: "20px"
  px-24: "24px"
  px-25: "25px"
  px-27: "27px"
  px-28: "28px"
  px-30: "30px"
  px-32: "32px"
  px-35: "35px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.sm}"
    padding: "10px 25px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-secondary:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    padding: "10px 25px"
  button-secondary-hover:
    backgroundColor: "{colors.secondary-hover}"
  input-auth:
    backgroundColor: "{colors.input}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    padding: "10px 13px"
  search:
    backgroundColor: "{colors.search-ground}"
    textColor: "{colors.text}"
    rounded: "{rounded.search-pill}"
    padding: "0 15px"
    height: "47px"
  navigation:
    textColor: "{colors.muted}"
    rounded: "{rounded.sm}"
    padding: "12px 17px"
  choice:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.base}"
    padding: "12px 15px"
  artwork-card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.sm}"
  fusion:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.base}"
    padding: "17px 18px 17px 23px"
  button-primary-light:
    backgroundColor: "{colors.light-accent}"
    textColor: "{colors.light-accent-ink}"
    rounded: "{rounded.sm}"
    padding: "10px 25px"
  button-primary-light-hover:
    backgroundColor: "{colors.light-primary-hover}"
  button-secondary-light:
    backgroundColor: "{colors.light-secondary}"
    textColor: "{colors.light-text}"
    rounded: "{rounded.sm}"
    padding: "10px 25px"
  button-secondary-light-hover:
    backgroundColor: "{colors.light-secondary-hover}"
  profile-field:
    backgroundColor: "{colors.input}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    padding: "10px 14px"
    height: "44px"
  profile-field-light:
    backgroundColor: "{colors.light-input}"
    textColor: "{colors.light-text}"
    rounded: "{rounded.sm}"
    padding: "10px 14px"
    height: "44px"
  profile-initials:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    typography: "{typography.profile-initials}"
    rounded: "{rounded.initials}"
    size: "64px"
  profile-initials-mobile:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    typography: "{typography.profile-initials-mobile}"
    rounded: "{rounded.initials}"
    size: "56px"
  profile-tab:
    textColor: "{colors.muted}"
    typography: "{typography.profile-label}"
    rounded: "0"
    padding: "10px 2px"
    height: "48px"
  profile-tab-selected:
    textColor: "{colors.accent}"
  profile-summary-row:
    typography: "{typography.profile-label}"
    padding: "14px 0"
  profile-theme-choice:
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    padding: "12px 16px"
    height: "56px"
  profile-theme-choice-selected:
    textColor: "{colors.accent}"
  assistant-drawer:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.text}"
    rounded: "0"
    width: "440px"
    height: "100dvh"
  assistant-backdrop:
    backgroundColor: "rgb(0 0 0 / 0.36)"
  assistant-welcome:
    typography: "{typography.assistant-welcome}"
  assistant-film-title:
    textColor: "{colors.text}"
    typography: "{typography.assistant-film-title}"
  assistant-footnote:
    textColor: "{colors.muted}"
    typography: "{typography.assistant-footnote}"
  assistant-message:
    backgroundColor: "{colors.navigation-selected}"
    textColor: "{colors.text}"
    rounded: "{rounded.assistant-message}"
    padding: "12px 15px"
  assistant-filter:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.assistant-pill}"
    padding: "6px 10px"
  assistant-refine:
    textColor: "{colors.text}"
    rounded: "{rounded.assistant-pill}"
    padding: "9px 13px"
  assistant-composer:
    backgroundColor: "{colors.input}"
    textColor: "{colors.text}"
    rounded: "{rounded.base}"
    padding: "10px"
  assistant-send:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    rounded: "50%"
    size: "44px"
---

# Design System: AIVerse

## Overview

Content authority update2026-10-25: the user removed runtime mock data. Earlier references in this document to demo film titles, generated sample artwork, demo identifiers, fixture durations and browser-local demo saves are historical records of the retired demonstration. They do not authorize current application content. Runtime discovery uses only published database records, auth uses approved published covers or a quiet empty panel, and interests persist through verified account APIs. Deterministic fixtures belong only in tests. PRODUCT.md and the published-only home/auth amendments govern this supersession; all visual tokens and component styles remain unchanged.

**Creative North Star: "Late-night screening room"**

Artwork leads; the surrounding interface recedes into restrained surfaces. Dark remains the default screening room; the user-requested light appearance adds pale grounds, dark ink and deeper violet controls. Violet gives actions and selected states a consistent point of orientation. Film titles bring a literary serif voice into a practical sans-serif interface.

This system is extracted from the global stylesheet, shared components, font imports and profile implementation. The supplied cinematic sidebar reference remains the home authority; `.impeccable/surface-home.md` retains that composition. The current minimal profile contract lives in `.impeccable/surface-profile.md`; the former all-visible C overview is historical at `.impeccable/history/profile-overview-before-minimal.md`. This merge records implemented visual rules; bounded browser evidence and remaining finish/method gates are recorded in the delivery vault, not inferred from this document.

**Key Characteristics:**

- Cinematic artwork with readable foreground captions.
- Dark or light tonal layers, quiet borders, and restrained violet actions.
- Expressive serif film titles paired with readable sans-serif controls.
- Explicit demo status and accessible, labeled interactions.

## Colors

The default palette is a near-black screening environment with pale violet direction and cool neutral text. Light appearance uses pale neutral ground, white surfaces, dark ink and deeper violet for readable controls. Frontmatter is normative: unprefixed colors match default CSS custom properties; `light-` colors map to the same properties under `:root[data-theme="light"]`. The sidecar theme mapping references these tokens rather than creating another primitive scale.

### Primary

- **Screening violet** (`accent`): primary actions, selection, wordmark accent, icons, focus, and text links. Primary hover uses `primary-hover`.
- **Violet ink** (`accent-ink`): dark text on violet actions and text selection.

### Light appearance

- **Day ground / paper surface / field wash** (`light-ground`, `light-surface`, `light-input`): document, containers and form depth.
- **Day ink / caption ink** (`light-text`, `light-muted`): primary and supporting copy; placeholder uses `light-placeholder`.
- **Day violet / white action ink** (`light-accent`, `light-accent-ink`): primary actions, focus, caret, text selection and radio selection. Hover uses `light-primary-hover`.
- **Day secondary tones** (`light-secondary`, `light-secondary-hover`): subdued actions.
- **Day structure** (`light-line`, `light-rail-ground`, `light-rail-line`, `light-topbar-line`, `light-field-line`, `light-search-ground`): dividers, shell, strong field edges and the search surface.
- **Day navigation and choices** (`light-navigation-hover`, `light-navigation-selected`, `light-choice-selected`, `light-choice-selected-text`): hover, current-page links and chosen preference buttons.
- **Day feedback** (`light-error`, `light-success`): semantic feedback, not extra brand accents.

### Neutral

- **Night ground** (`ground`): page and document background.
- **Projection surface** (`surface`): Fusion, empty states, callouts, preference options, and artwork placeholders.
- **Field depth** (`input`): selects and account inputs.
- **Quiet divider** (`line`): shared form borders, Fusion boundaries, and scrollbars.
- **Screen text** (`text`): primary readable foreground.
- **Caption gray** (`muted`): metadata, secondary navigation, explanatory text, and footer.
- **Secondary action tones** (`secondary`, `secondary-hover`): subdued alternative actions.

Rail, topbar and navigation use their matching semantic tokens in both themes. Search uses `search-ground`, `field-line` and `placeholder`; light native fields use the stronger `light-field-line`. Choice selection uses `choice-selected` and `choice-selected-text`. Primary and secondary buttons resolve all default/hover colors through semantic variables. Text selection pairs `accent` with `accent-ink`. Error and success use their semantic tokens for message text. Those colors communicate state and are not extra brand accents. The implementation has no reusable cyan UI token; cyan belongs to artwork where present. Sidecar tonal ramps are synthesized preview metadata, not an implemented color scale.

**The Honest Accent Rule.** Use violet to identify interaction and selection; never use visual emphasis to imply unavailable playback or fabricated live activity.

**The Artwork Contrast Rule.** Featured-film and auth artwork captions retain their dark screening-room text/accent scope in either appearance; switching the document to light must not turn captions dark over artwork.

## Typography

**Display Font:** Cormorant Garamond, serif fallback. The bundled import supplies weight 400.
**Body Font:** DM Sans Variable, sans-serif fallback. The variable family is bundled locally through Fontsource.

**Character:** The serif gives featured films a quiet editorial identity. Sans-serif navigation, forms, metadata, and ordinary page titles keep the viewing task readable.

### Hierarchy

- **Display:** the featured film title uses the frontmatter display role; it reduces to 43px at the 1250px breakpoint and 39px with line-height 1.05 at 700px.
- **Headline:** ordinary page h1 uses the headline role and reduces to 32px at 700px.
- **Title:** section h2 uses the title role. Film-card h3 uses 18px at weight 500, rising to 19px on mobile.
- **Body:** the body role is the base. Page introductions use 16px with line-height 1.65 and a 68ch maximum; mobile introductions use 15px.
- **Label:** the label role covers form captions and demo notes. Buttons use 14px at weight 600. Metadata varies from 11px to 14px by context and uses tabular numerals.

**The Quiet Interface Rule.** Reserve Cormorant Garamond for the featured film title; controls and general page headings use DM Sans Variable.

### Profile-local hierarchy

The profile is a local DM Sans extension. Frontmatter records its compact page heading, section heading, muted account name, list/content titles, recorded totals, descriptions, supporting text, labels and initials. The page heading and initials reduce at the existing 700px breakpoint; section headings keep their local role. Existing label covers metadata/help text; body remains ordinary controls. Profile totals use tabular numerals. Long names and content titles wrap naturally. These roles describe the implemented minimal profile without rescaling home, auth or Reels.

### Assistant-local hierarchy

Ask AIVerse inherits DM Sans and the existing title/label/body roles. Its local welcome, film-title and footnote roles are recorded in frontmatter; they do not rescale other screens. The welcome uses the inherited h3 weight and body line-height. Replies use 15px/1.65, the welcome explanation 14px/1.65, user messages and composer 14px, history 13px/1.6, and result reasons 13px/1.65. Filter labels and metadata use 12px; refinement controls use 13px. The footnote alone uses the compact local role, with a tabular character counter.

## Layout

The desktop shell uses a persistent left rail with labeled Home, Reels, Movies, and Fusion navigation. The signed-in private account name links to the profile at the rail's foot; guests see Log in. The workspace aligns to the rail, with search and the demo notice above content. The actual rail width is 188px, reducing to 160px at 1050px. The top bar is 81px tall. Home-specific feature-frame and Fusion composition remain in the surface brief.

The catalog grid uses three columns with 16px gaps. At 1050px it uses two columns; the final home-shelf card remains half-width. At 700px the rail becomes a compact header with four labeled navigation items, the workspace loses its left offset, Fusion stacks, and the catalog becomes one column with 25px gaps. Form choice grids move from three columns to two. Account forms cap at 440px; preference content caps at 820px.

Breakpoints are source-derived: min-width 1600px; max-width 1250px, 1050px, and 700px. Wide screens increase the featured frame from 510px to 580px; mobile uses 490px with a stronger gradient and caption layout. No carousel, swipe rail, or auto-advance is implemented.

Spacing entries in frontmatter describe recurring literal dimensions, not CSS custom-property declarations or a universal mathematical scale. Content gutters vary by context: shelves use 27px desktop and 16px mobile; ordinary pages use 35px desktop and 20px mobile.

The private profile caps at 1040px with 32px 30px 64px page padding. Its compact identity header leads into a four-task tab row with 24px gaps and a 28px top margin; exactly one task panel appears, with 28px top padding. Account content caps at 700px. Read-only summary and edit rows use a 180px label track, flexible values and a 24px gap. Summary rows have 14px vertical padding; editing fields use a 16px row gap. Optional settings use a native disclosure below the account task. The shared footer is omitted only on `/profile` to avoid a repeated action wall; other routes retain it.

At 700px, profile padding becomes 24px 20px 44px, tab/panel top spacing becomes 24px, tabs distribute evenly, and summary rows use a 112px label track with a 16px gap. Editing fields stack with 7px label/input gaps; statistics become two columns and content rows wrap. Controls retain at least 44px interaction height; tab buttons are 48px tall. Profile spacing entries are observed local dimensions, not a new universal mathematical scale. The former 1600px two-column overview, extra 1200/1000px profile breakpoints and illustrated appearance miniatures are no longer current profile rules.

Ask AIVerse is an approved local right-drawer extension, governed by `.impeccable/surface-assistant.md` and selected mock A. Its fixed, square-edged native dialog is 440px wide with a 100% maximum and 100dvh height; at 700px it becomes full width and removes the left border. A fixed-size header and composer bracket one flexible scrolling region (min-height 0, contained overscroll), keeping the composer anchored below results. Header and scroll gutters are 24px desktop/20px phone; the header top and composer bottom account for safe-area insets. The composer outer padding is 14px 20px with a minimum 14px safe-area bottom. The existing topbar accommodates the launcher; at 700px it uses a search/launcher grid, with the demo notice below. Between 701px and 1250px that topbar notice is hidden; assistant-local catalog/demo disclosure stays present.

## Elevation & Depth

Depth comes from tonal layering, quiet one-pixel borders, and dark gradients over artwork. No box shadows are implemented. The featured image has a bottom gradient for foreground text and a lateral shade; mobile strengthens the bottom shade. Do not apply generic floating-card shadows to this world.

Buttons transition background and color over 0.18s with ease. Artwork enlarges to 1.025 on hover over 0.3s using cubic-bezier(.16,1,.3,1). The reduced-motion media query removes transitions and animation, removes artwork scaling, and changes smooth document scrolling to auto.

Profile panels are flat. Fine summary-row dividers and a selected tab underline provide structure. Compact theme choices use a violet selected border and a separate keyboard focus outline; they add no elevation or animation.

The assistant adds modal dimming using the component-local backdrop token, without adding a brand color or shadow. Opening translates from 28px to 0 over 0.25s with cubic-bezier(0.16, 1, 0.3, 1); prefers-reduced-motion removes this animation. The drawer remains flat with a one-pixel left divider on desktop.

## Shapes

Corners stay lightly softened: the compact radius for buttons, navigation, selectors, account inputs, and artwork; the base radius for compound surfaces, callouts, and preference choices; the larger radius only for empty results. Borders define fields and grouped controls. Artwork is clipped within its rectangle, with a desktop aspect ratio of 1.83 and a mobile ratio of 1.8.

The profile retains compact rectangular fields and theme choices with the compact radius. Tabs have square corners and a selected bottom rule. Account initials are an explicit circular exception (64px desktop/56px mobile); the approved shared search remains a pill exception. Ask AIVerse adds only its approved local filter/refinement pills and circular send/stop control. The former miniature preview radii and decorative schematic marks are obsolete profile patterns and must not guide new screens.

Ask AIVerse user messages use the local asymmetric message radius (three 12px corners and a 3px lower-right corner). Its recognized-filter chips and refinement controls share the local pill radius; the send/stop control is circular. The composer and artwork retain the existing base radius. These approved A component exceptions do not make rounded bubbles or pills the default for other surfaces.

## Components

### Buttons

Compact and clear. Primary and secondary variants share the frontmatter dimensions and use a 10px icon gap. Primary hover brightens violet in dark appearance and deepens violet in light appearance; secondary hover follows the semantic neutral tone. Shared disabled buttons use opacity .5 and a not-allowed cursor. Visible keyboard focus uses a 2px violet outline with 4px offset. Text actions retain a 44px minimum height.

### Inputs / Fields

Account fields use a one-pixel divider border and the input surface. Light native fields use the stronger field-line semantic border. Profile inputs are at least 44px tall with 10px 14px padding; read-only email uses surface and muted text. Visible text labels, email/password autocomplete, input limits, and disabled/busy states are implemented. Status messages use status or alert roles. Search is a wide bordered field with an explicit accessible name and the user-approved shared-search pill shape (9999px radius); its mobile submit button has an accessible Search label. Native Fusion selects have visible labels; they are 40px high on desktop and 44px on mobile.

### Navigation

Muted icon-and-label links sit in the fixed desktop rail. Hover uses navigation-hover; the active page uses navigation-selected and `aria-current="page"`. Mobile keeps four visible labels in a horizontal row. Decorative Lucide SVG icons are hidden from assistive technology. The document includes a focus-revealed Skip to content link.

### Cards / Containers

Film cards pair linked sample artwork with a linked title and metadata. Artwork links have explicit detail labels, and images identify their AI-generated sample nature. The title link becomes violet on hover. Empty results and demo callouts use tonal surfaces and plain language instead of implying content exists.

### Preference choices

Bordered buttons use `aria-pressed` and a check icon for selected state, with a violet border and darker violet fill. Genre selection is limited to eight choices; saving requires at least five. Count feedback is polite live text. Fieldsets and legends group genres and optional content inspiration. Cultural labels describe content preference rather than personal ethnicity.

### Fusion

A bordered, lightly rounded form groups content inspiration, genre, and format. Native selects submit canonical query parameters to the Fusion page. Results are restricted to matching published fixtures; empty results explain when no exact match exists.

### Profile and appearance choices

Initials derive from the actual account name. Account, Content, Statistics and Appearance use semantic tabs with `aria-selected`, roving tab focus and linked tabpanels. Arrow Left/Right wrap; Home/End select the first/last task. Hash links, Back and Forward select the same single visible panel. Inactive panels use the native hidden attribute and stay mounted so pending account edits and an opened studio's child state survive task switches.

Default Account is a four-row read-only summary with Edit details. Editing reveals labeled fields and Save details/Cancel; Cancel restores saved values. More settings discloses interests and optional personal information. Appearance uses compact Dark/Light labels, native 18px radios and decorative Moon/Sun SVGs, with 12px 16px padding and a 56px minimum height; mobile uses 12px padding. The selected border/text use accent; keyboard focus uses the 2px outline with 4px offset. There are no illustrated theme miniatures in the current profile.

Appearance is saved per verified account and applied to the document's data-theme through the root provider. Dark is the account default. Device storage is a first-paint/guest fallback; a verified account's saved value takes precedence, and another account does not inherit that fallback as its preference. Pending saves keep their ownership and busy state across focus/path refreshes; obsolete reads cannot roll back a completed save. Failed loads/saves show recoverable status without announcing a false success. Radios disable while saving and inherit reduced-motion behavior.

Content rows and statistics render actual owned records in their respective tasks. Totals cover retained records, independently of the recent list's 20-item cap. About these numbers discloses the retained daily-credit definition, workflow counts and the distinction from views or unique viewers. Content alone opens the real creator studio inline on request; unavailable provider states remain explicit there. User-directed update2026-10-26: verified, unsuspended users prepare private revisions directly, without a creator application or approval prerequisite. Human video review, owner isolation and upload limits remain. No mock identity, count or raster UI is shipped.

### Ask AIVerse

A compact native modal catalog helper extends search. The source contract and approved A mock govern topology; real catalog metadata and existing semantic colors govern content. The header uses the existing title role, a catalog/demo subtitle, New search, and a labeled 44px Close control. The welcome offers three plain divider-separated prompts. Results show visible recognized filters, grounded reply text, actual linked artwork/title/metadata, explicit View details and More like this controls, and separately labeled broader suggestions. Open in Fusion and the existing signed-in saved-mix form reuse canonical filters. No new raster ships with this component.

The anchored composer uses a labeled, 500-character textarea, a 44px circular send/stop control, and a compact rule-based/catalog disclosure with character count. Enter sends, Shift+Enter inserts a newline, and composition input is respected. Pending, Stop, Retry, clarification and unavailable states keep recoverable context; New search clears the conversation and current filters. Native modal behavior handles focus containment and Escape; closing restores launcher focus and body scroll. Buttons and links inherit the shared 2px accent focus outline with 4px offset; the textarea has its own 3px offset. The background is modal, not another scrollable interaction region. Conversation is session-memory only, capped at eight turns; confirmed account changes/loss clear it, and stale requests cannot repopulate it.

### Watch later and fixture honesty

Watch later is a pressed-state button that stores demo identifiers in this browser and changes its label to Saved on this device. Storage failure produces an alert. It does not imply an account-synchronized library.

The persistent demo notice states that artwork is sample content with no live playback. Detail links say View details. Durations are fixture labels, not measured media; current published samples range from 75 to 178 seconds. The approved visual reference contains different example metadata, so implemented catalog data remains authoritative. Do not introduce pretend player controls, views, likes, endorsements, or creator totals.

## Do's and Don'ts

### Do:

- **Do** use semantic violet and neutral tokens for controls and surface hierarchy in both appearances.
- **Do** pair locally bundled DM Sans Variable controls with Cormorant Garamond featured-film titles.
- **Do** preserve visible demo disclosure, explicit detail actions, and browser-local save language.
- **Do** retain labeled navigation, visible keyboard focus, semantic form labels, and reduced-motion behavior.
- **Do** keep current fixture data separate from image-reference example metadata.

### Don't:

- **Don't** invent live playback, activity counts, endorsements, or production catalog availability.
- **Don't** add a carousel or auto-advance to the approved sidebar home composition.
- **Don't** add unimplemented cyan UI tokens, floating-card shadows, or pill-shaped defaults beyond the approved shared search and assistant-local filter/refinement controls.
- **Don't** compress desktop navigation labels into unreadable mobile controls.
- **Don't** infer visual SHIP, method completion or release acceptance from this source documentation pass.
