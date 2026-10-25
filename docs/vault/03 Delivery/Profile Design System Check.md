# Profile design system check

[[Home]] · [[03 Delivery/Profile Hub Progress]] · [[03 Delivery/Minimal Profile Review]] · [[03 Delivery/Build Log]]

2026-10-24. Authorized merge of the implemented minimal profile into the incumbent **Late-night screening room** system. The user's request to reduce overwhelm supersedes the all-visible C layout; .impeccable/surface-profile.md is current and .impeccable/history/profile-overview-before-minimal.md preserves the earlier direction. This source documentation pass does not close method/release gates.

## Source and scope

Read the shipped documenter role and reference/document.md, PRODUCT.md, incumbent DESIGN/sidecar, the current profile contract, global/profile styles, profile panel, section navigation and AppShell. The merge changes normative documentation and bounded delivery notes only. It does not change app source, SQL, tests, STATE, environment, identity or unrelated surface rules.

## Current local rules recorded

The complete **23 dark / 23 light** semantic palette and its keyed sidecar color metadata/theme mapping remain unchanged. Global typography, home/auth/Reels directions, pill search, thin borders, flat surfaces and focus treatment remain incumbent. No global color, type family or token-value change is introduced.

Profile-local frontmatter now describes the actual compact hierarchy: 28/24px page heading, 20px task heading, 15/14px muted name, 16px list heading, 15px content title, 22px totals, 14px descriptions/labels, 13px support text, and 24/22px initials inside 64/56px circles. Metadata/help retains 12px. Profile fields and compact theme choices use 5px corners. The obsolete miniature-only 7/2/3px radius primitives, 37/30px overview title and 113/72px identity geometry were removed from the current profile specification.

The profile caps at 1040px with 32px 30px 64px padding, changing to 24px 20px 44px at 700px. One task panel appears below 48px semantic tabs. Four-row Account summary and on-request editing cap at 700px, with 180px desktop and 112px mobile summary-label tracks. Editing fields stack on mobile. Native More settings and About these numbers disclosures retain secondary information without initial clutter. Content alone opens the existing studio, preserving pending child state while its task is hidden. The shared footer is omitted only on /profile.

The appearance component is now a compact native radio with a Moon/Sun SVG, 18px radio, 56px minimum height, 12px 16px desktop padding and 12px mobile padding. Accent border/text communicates selection; the 2px/4px keyboard outline remains distinct. Sidecar snippets are self-contained HTML/CSS with live semantic variables and inline SVGs. The old continuous anchor navigation and illustrative miniatures were replaced; sidecar 1200/1000px profile breakpoints and miniature palettes were pruned. New static tab/summary previews describe interaction ownership honestly; application code owns selection and form logic.

## Detector and validation

The retained .impeccable/review/profile-minimal/detector.json contains **one advisory / zero nonadvisory findings** for the implemented 28px profile heading. Its local role is now recorded from source, not introduced to disguise a defect. The detector was saved once and has not been rerun after this documentation merge. The former 72-advisory overview scan remains historical.

Documentation validation **PASS**: JSON/YAML parse; exact source/frontmatter/sidecar parity for all 23 dark and 23 light colors; theme references, component schema and token references resolve; typography metadata and narrative match; obsolete miniature tokens are absent; scoped Prettier passes for all seven changed documentation files. Functional evidence is independently ACCEPT at 27 targeted tests, typecheck and scoped lint; parent production build passes at 38 pages. The fresh finish reviewer re-read updated DESIGN/sidecar, confirmed the stale normative finding resolved and returned **SHIP for the current minimal-profile scope**, with no material corrections. No method or release completion is inferred.

## Assets, drift and gates

No profile raster UI ships; initials, radios, icons and disclosures are semantic HTML/CSS/SVG. Prior native image mockups retain their provenance as historical review artifacts. Unrelated pre-existing drift was neither canonized nor repaired. The current source merge does not clear the prior plates/semantic asset-plan, comp CLI/skill sequencing mismatch, home/auth method/artwork, provider, policy or release gates. The persistent viewer-only Local Preview account remains available to the user.
