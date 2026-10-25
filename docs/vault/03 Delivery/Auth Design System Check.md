# Auth design system check

[[Home]] · [[03 Delivery/Auth Onboarding Design Review]] · [[03 Delivery/Auth Onboarding Verification]]

2026-10-24. Bounded Impeccable documenter check of the ordinary authentication/onboarding extension and dashboard arrival. The incumbent visual world remains **Late-night screening room**. Option B and the user's explicit catalog-thumbnail carousel amendment are recorded in `.impeccable/mocks/auth-decision/b.png.json` and `.impeccable/surface-auth.md`. No new global design decision is required: `DESIGN.md` and `.impeccable/design.json` are preserved without modification.

## Evidence and scope

Read the shipped `impeccable_documenter.toml` role and `reference/document.md`; checked `PRODUCT.md`, `DESIGN.md`, `.impeccable/design.json`, `.impeccable/surface-auth.md`, the approved B prompt/sidecar, and current build state. Source evidence is `src/app/globals.css`, `src/app/layout.tsx`, `src/components/auth-experience.css`, `auth-experience.tsx`, `auth-form.tsx`, `onboarding-form.tsx`, `app-shell.tsx`, `account-actions.tsx`, `src/app/dashboard/page.tsx`, and the published demo catalog.

The account evidence directory currently contains 14 captures: login, email, verification, information, interests, personal details and dashboard at desktop/mobile sizes. The earlier independent finish review evaluated the original 13-capture set; the parent subsequently supplied desktop verification and replaced email/verification captures after semantic-label refinement. This documenter sampled approved B, desktop login, mobile interests and desktop personal details. It does not substitute for the independent reviewer's full visual verdict or claim a new browser interaction run.

## Palette: all 13 entries agree

An exact source comparison confirmed all 13 `DESIGN.md` color entries match their sidecar canonical values and current CSS use. There are **10 root color custom properties and three literal button-state mappings**, rather than 13 declared CSS variables.

| Design color | Current CSS binding/use | Current value | Result |
| --- | --- | --- | --- |
| ground | `--ground` | `#0c0d10` | Match |
| surface | `--surface` | `#14151d` | Match |
| input | `--input` | `#1b1c27` | Match |
| line | `--line` | `#333542` | Match |
| text | `--text` | `#f5f3fa` | Match |
| muted | `--muted` | `#b5b7ca` | Match |
| accent | `--accent` | `#bda9ff` | Match |
| accent-ink | `--accent-ink` | `#211630` | Match |
| error | `--error` | `#ffb0b5` | Match |
| success | `--success` | `#b8e5cd` | Match |
| primary-hover | `.button.primary:hover` literal | `#d0c1ff` | Match |
| secondary | `.button.secondary` literal | `#242432` | Match |
| secondary-hover | `.button.secondary:hover` literal | `#313143` | Match |

Auth controls reference the existing semantic variables. The dark artwork gradients use the ground RGB channels with opacity. Selected onboarding chips use the local literal `#28263e`, already present in the incumbent active navigation. The inline Google mark carries its own four brand colors; those are logo artwork, not new AIVerse palette tokens. No cyan token, shadow vocabulary or replacement brand accent is introduced. Existing sidecar tonal ramps remain preview metadata, not an implemented CSS color scale.

## Typography, spacing and shape

`src/app/layout.tsx` still bundles DM Sans Variable and Cormorant Garamond 400 through Fontsource. Root `--body-font` and `--display-font` match the recorded families. Auth fields, controls, ordinary headings and dashboard copy use DM Sans; the artwork's featured-film caption uses Cormorant. The offline font-ranking suggestion does not supersede this incumbent choice or approved B.

The auth surface has local, purpose-specific dimensions; this check records them without expanding the normative global token ramp:

| Local role | Desktop | Responsive behavior |
| --- | --- | --- |
| Entry/loading/saving heading | 40px, weight 500, line-height 1.18, tracking −.025em | Entry heading 32px at 760px |
| Onboarding heading | 34px | 30px at 760px |
| Artwork caption | 30px serif, line-height 1.2 | 25px at 760px |
| Dashboard welcome | 38px | 31px at 760px |
| Form input | 16px, minimum 52px high | Retains 16px input text |
| Form labels and supporting copy | 14px labels; 16px entry introduction; 14px onboarding introduction | Labels 13px; entry introduction 14px |
| Helpers, disclosure, counters and controls | Context-specific 11–14px; code input 28px with tabular digits | Artwork disclosure/progress labels 10px; compact wordmark 22px then 20px at 360px |

The stable task column caps at 410px. Desktop uses a 56%/44% split and 76px header; at 1050px the split becomes 48%/52%. At 760px it stacks into a 230px artwork band and form beneath a 64px header. Desktop task padding is 56px 40px, mobile 34px 24px 40px, and the narrowest form gutter is 20px. The 1650px auth padding breakpoint is a surface-local addition. Form gaps of 22px/20px and the 28px/32px/40px heading/progress separations serve this form, not a new universal spacing scale.

Existing buttons, fields, chips and pause control keep 5px corners. Thumbnail corners are 4px; the inset password-visibility control is 3px. Circular numbered progress markers communicate progress rather than changing the default button shape. Depth remains tonal/border/gradient based, without floating-card shadows. Source provides 52px primary auth actions and fields, 44px text actions, chips, visibility and carousel controls, and thumbnails at least 44px high.

## Focus, labels and pending states

- The global 2px violet `:focus-visible` outline remains in place for buttons, links, inputs and selects; auth inputs adjust its offset from 4px to 2px. Programmatically focused step headings alone suppress the noninteractive heading outline. Email expansion focuses the email field; verification and onboarding transitions focus the heading. The shell retains Skip to content.
- Password and verification labels are separately associated through `htmlFor`/`id`; helpers use `aria-describedby`. Email, name, age, contact and personal ethnicity retain visible labels. Password visibility has Show/Hide names; code entry uses numeric input mode, one-time-code autocomplete and six-digit constraints.
- The three named progress steps use `aria-current="step"`. Genre choices expose `aria-pressed`, a check and a polite selection count. Optional inspirations are expressly distinguished from personal ethnicity. Personal ethnicity is optional, self-described and paired with affirmative consent plus a clear skip path.
- Email submission marks the form busy, disables its controls and supplies stage-specific pending copy. Resend has a real countdown and recovery text. Errors use alerts and notices use status roles. Unconfigured Google stays disabled with an explanatory note; it does not display local success.
- Loading and saving replace the onboarding task with named status content. Saving waits for the POST response before dashboard navigation; failure restores the entered form and retry message. The dashboard shows private account values and explicit Edit/Log out actions; logout supplies disabled/pending/error feedback. These are source checks, with runtime/backend evidence owned by the separate verification reports.

## Motion and auth-only carousel

The user amendment authorizes four existing published catalog thumbnails in the auth artwork column only. `AuthExperience` runs an 8-second interval, pauses for explicit pause, pointer hover, focus inside the artwork, document invisibility, and reduced motion, and clears the interval when those conditions change or the component unmounts. Thumbnail buttons have film-specific accessible names and pressed state. Decorative slides are hidden from assistive technology. The pause control's label describes reduced-motion unavailability when disabled.

The local crossfade is 900ms using cubic-bezier(.16,1,.3,1); the visible-default heading reveal is 250ms with a 6px translation and 1px blur; pending spinners use 1.2s rotation. Both local and global reduced-motion CSS remove animation and transitions, while the JS media-query check stops auto-advance and leaves manual selection available. Global reduced motion also restores automatic document scrolling and removes home artwork hover scaling. This documenter verified source handling, not elapsed-time browser playback. The home composition remains outside the carousel amendment.

## Detector disposition and records preserved

`.impeccable/review/account/detector.json` contains **41 advisory findings only**: 38 font-size, two radius and one color. Unique flagged font sizes are 10, 11, 13, 14, 16, 18, 20, 21, 22, 25, 28, 30, 31, 32, 34 and 40px. The radii are 3px and 4px; the color is `#28263e`. Several are already described as contextual values in incumbent prose, while the detector compares against the smaller frontmatter scales. Their presence does not establish a material rendered defect, and no value was added to global tokens merely to silence a warning. They remain recorded local advisories.

The incumbent global Layout sentence saying no carousel is implemented and account-navigation descriptions predate this extension. Read them in their original home/incumbent scope together with the explicit home no-carousel guardrail; the auth-only amendment is documented in `surface-auth.md` and here. This ordinary extension does not authorize general drift repair, a global carousel rule, or replacement of the visual world. No durable system change was canonized.

## Raster provenance and method limits

The three new design-choice raster mocks, `a.png`, `b.png` and `c.png` under `.impeccable/mocks/auth-decision/`, each have a prompt file and JSON sidecar. A PNG chunk inspection confirmed embedded `impeccable:prompt` text and C2PA `caBX` data in all three; this checks presence, not cryptographic signature validity. Approved B's sidecar records the seed and the user's reuse/carousel amendment. The mocks are design evidence rather than shipping auth imagery.

Shipping auth artwork references the existing catalog's `midnight-v2`, `greenhouse-v2`, `cat-v2` and `tides-v2` plates. Their prior generation-reference/prompt sidecars remain in place. No new artwork was generated, rewritten or re-provenanced in this documenter pass; prior home artwork acceptance remains separate.

Current `.impeccable/build/state.json` still records spec closed, plates open with a failed 19% static-image structure comparison, and subsequent hero/sections/motion/responsive/review phases pending. User approval of existing thumbnails changes the expected auth behavior; it does not turn that automated plate result into a pass. This system check completes bounded documentation only. It grants no automated plate pass, separate asset-board acceptance, full Impeccable method completion or whole-project release acceptance. The independent design review owns the finish disposition.
