# Auth and account onboarding

Mode: Operate. User task: enter by email/password or Google; verify an emailed signup code; complete information, interests, then optional ethnicity; save and arrive at the dashboard. Existing home visual identity is fixed.

## Direction candidates

Ranked structures: (1) dedicated cinematic split, (2) centered form on full backdrop, (3) existing rail plus form and film portrait, (4) vertical form with film strip above, (5) compact top navigation plus centered surface and restrained cinematic strip, (6) form plus tiled art, (7) quiet single column. Surface seed 7b748c26 dealt 3, 1, 5, shown as A, B, C. Network retry succeeded. User selected B and explicitly amended the artwork column to a carousel based on catalog thumbnails. Approved comp: `.impeccable/mocks/auth-decision/b.png`. Existing catalog plates are reused; no new artwork is required.

## Direction contract

THESIS: Account entry is a dedicated split screen: a cinematic invitation beside one focused, stable form.
OWN-WORLD: Inherit DESIGN.md's near-black surfaces, pale violet controls, DM Sans, quiet borders and lightly softened corners. Preserve existing home artwork and typography.
STORY: Choose email or Google; email signup verifies a code before private profile setup. Three clear steps end with a real save and dashboard navigation.
FIRST VIEWPORT: Slim wordmark/browse header, left artwork at slightly over half width, right 410px task column. Thumbnail selectors and pause control sit within the left artwork. Mobile uses a compact artwork band above the form.
FORM: Dedicated cinematic split, candidate 1 dealt second, option B; seed 7b748c26. The user's thumbnail carousel amendment controls artwork behavior.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Functional contract

Guests see Log in; authenticated users see their saved account name. Email entry expands a labeled form. Signup uses a real six-digit email verification step and resend; code confirmation must precede authenticated onboarding. Google is unavailable until configured and must never claim success locally without credentials.

Information: full name, age, optional contact number. Interests: existing 5–8 genre selection with skip; content inspirations remain content preferences. Personal ethnicity: optional self-description with explicit consent and skip; private owner-only storage, no public projections or recommendation use. Finish uses truthful saving feedback, error recovery and successful completion before dashboard navigation. Reduced motion removes decorative transitions.

## Existing gates

Home artwork acceptance and old build state/spec are preserved separately under `.impeccable/history/`. Auth comp B is approved with the user's explicit thumbnail-carousel amendment. The automated plate gate still compares the original static mock artwork to the existing catalog plate and fails (19% structural match); it also requests a separate asset-board acceptance. The existing-thumbnail direction is the user's current instruction and overrides regenerating that static image. No automated plate pass or separate asset-board approval is claimed. Font measurement's offline ranking suggested Cause, but the established DESIGN.md and approved mock specify DM Sans; preserve the existing font. Finish review must judge the amended split-screen/carousel contract and report these method limitations separately.

# Published-only artwork update — 2026-10-25

The user removed sample catalog data/artwork. Preserve the approved cinematic split structure and account task. The carousel now receives only bounded public published cover metadata and omits failed/revoked artwork; no covers/offline means a quiet brand/purpose panel with no fake film or controls. Single-image states omit redundant carousel controls. Native controls and existing reduced-motion, focus/hover and visibility pauses remain for multiple actual covers. No new raster assets or identity change; old fixture-art references below are historical only. Account access remains usable when catalog loading fails.
