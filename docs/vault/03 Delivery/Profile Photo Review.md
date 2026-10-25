# Profile photo

[[03 Delivery/Roadmap]] · [[03 Delivery/Minimal Profile Review]] · [[02 Architecture/Decisions]]

2026-10-24. User requested an edit icon on avatar hover to change their profile photo. The minimal profile and 64/56px avatar remain. A Lucide pencil appears on hover and keyboard focus, with a persistent affordance for non-hover touch devices. The native JPEG/PNG/WebP picker saves automatically, shows pending/error/success feedback, and retains initials without a usable photo.

## Persistence

Migration `202610240012_profile_avatar.sql` was applied transactionally to dedicated local `aiverse-ana` and recorded in history without reset. Small owner-private `account_avatars` rows are separate from public profiles. Verified-owner RPCs derive identity, deny direct writes and enforce owner-read RLS. No external storage, public URL or Cloudflare operation was added.

The Node API requires a verified session and matching comparison-only `X-AIVerse-Account`; POST also requires the same origin. Streamed bytes are bounded at 5 MiB regardless of Content-Length. Sharp validates actual JPEG/PNG/WebP, rejects animation and images over 16 megapixels, honors orientation, strips metadata and center-crops to 256×256 WebP (quality80, maximum64 KiB). Original bytes are not stored. Responses are private/no-store. Account-keyed state, aborts and generations prevent stale image replacement.

## Verification

- Independent functional **ACCEPT**: 20 tests across four files (8 avatar route/image, 4 avatar SQL/RLS, 5 existing profile route, 3 navigation), typecheck, scoped ESLint and formatting. Additional independent image-boundary and component-hook probes pass. Local migration/table and least grants independently inspected.
- Parent production build: **39 pages PASS**. No current full-suite rerun claimed.
- Real local HTTP passes owner save/read, 256px metadata-free WebP and no-store; invalid bytes400, MIME spoof400, SVG415, excess size413, stale identity409, foreign origin403 and anonymous401. Rejections preserve the saved photo.
- Native browser picker returned “Profile photo saved.” Reload rendered a loaded256px image. Keyboard focus revealed pencil opacity1. Phone DOM width/scrollWidth both380px, avatar56px. Light inspected and Dark restored. Hover/touch media rules checked in source; no actual touchscreen test claimed.
- Five opened document-top captures under `.impeccable/review/profile-avatar/`: photo-desktop, focus-desktop, photo-mobile, initials-mobile-light, initials-desktop. Desktop PNG1440×1000; mobile380×976. Synthetic solid-color test photo conditionally restored to exact original initials baseline.
- HTTP fixture logout invalidated the preview session; parent restored the existing viewer through normal sign-in. Local Preview remains signed in, without a new role/account.
- One retained detector run: **zero findings**. No decorative shipping raster or global token change.

Fresh independent finish **SHIP**, no material fixes, at this avatar-addition scope. Documentation comparison **PASS** for this ordinary extension. Historical method, provider and release gates remain separate and open.

## Design-system comparison

The documenter compared PRODUCT, DESIGN, the sidecar, the current profile brief, shared theme/type rules, ProfileAvatar, profile CSS and its narrow ProfilePanel use. The circular identity remains 64px desktop / 56px mobile with 24px / 22px inherited DM Sans initials. The button exceeds the 44px action target; its 26px pencil badge is decorative within that button. Existing accent/ink/ground and muted/error tokens supply both themes. Focus retains the 2px violet outline and 4px offset. Hover/focus and non-hover affordances, concise live feedback and profile-wide reduced-motion overrides preserve existing interaction rules. The four-task minimal topology is unchanged.

No new visual world, global token, decorative shipping raster or provenance entry is needed: privately uploaded runtime photos are account content. Existing normative initials examples remain the fallback reference; this delivery note records the authorized photo interaction. Pre-existing documentation drift remains unmodified: DESIGN's broad no-carousel layout statement omits the auth-only exception, and the sidecar overview ends with an incomplete Key Characteristics label. Neither is repaired or canonized by this avatar comparison.

DESIGN and `.impeccable/design.json` remain byte-for-byte unchanged. Before/after SHA-256 values match:

- DESIGN: `B7F4B731E1ECFA35C1C7A7FF52B0E80310F575F1BADF2A12E0F511560D2A858C`.
- Sidecar: `6A088B71E79F90539D3AF743EAF0B301724CCAEEF101BA58C9395EDE0707F617`.

This documentation pass checks only the four changed vault documents with Prettier; it does not repeat the recorded functional tests, build, detector or browser review.
