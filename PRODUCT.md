# AIVerse

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Next.js App Router, TypeScript, Tailwind and Supabase Auth/Postgres/RLS. User-directed update2026-10-26: private Supabase Storage and a server-side Edge Function replace Cloudflare in the active video-upload/playback path. Legacy Stream adapters remain dormant compatibility/test code. Local verification precedes hosted migration and release acceptance.

## Users

Guests and signed-in viewers discover authorized AI-created entertainment. Verified, unsuspended users can submit their own media directly. Moderators review videos; administrators manage access and suspensions.

## Product Purpose

Help viewers find and watch actual AI-created reels and short films, with honest catalog-backed search and human-reviewed publication.

## Positioning

Fusion combines cultural/regional content inspiration, genre and format to expose true catalog matches, with explicitly labeled broader suggestions.

## Operating Context

Browse without login; optionally save preferences. User-directed update2026-10-26: creator applications and administrator approval are no longer prerequisites for uploading. Verified, unsuspended signed-in users may prepare and upload their own media within the existing quotas. Processing and human review precede publication. Build through small verified slices.

The user subsequently requested actual uploads without Cloudflare. The active implementation uses a private `aiverse-videos` Supabase Storage bucket for MP4/H.264 files up to50,000,000bytes. Movies retain20minutes, Reels3minutes and default quotas3uploads/day/30minutes/month. Actual local signed upload/private native playback is verified and its exact synthetic fixture removed. Hosted migrations018–020 and Edge Function v1 are installed; hosted binary/account journeys and the Git/Vercel application release remain pending.

## Capabilities and Constraints

User-directed update2026-10-25: runtime mock content is removed. Discovery reads only the anonymous published database projection; empty/offline catalogs never fall back to sample films. Auth artwork uses actual approved covers or a quiet text-only panel. Legacy demo-mode settings cannot revive fixture records or browser-only account preferences. Test fixtures stay under tests; private local data, media and review artifacts are excluded from public Git publication.

Only published records are public. Content-region labels describe content, never personal ethnicity. All initial uploads require review. No payments, payouts, paid AI, ad integration, video generation or native apps in this MVP. Development fixtures are clearly labeled; no fabricated playback or live statistics.

Active video delivery uses native controls and bounded signed URLs, with no raw public bucket access. The server inspects bounded MP4 container/sample structure, duration and codec; it does not fully decode, transcode or certify every media frame. Failed/hidden media becomes ineligible immediately, while physical cleanup waits out the signed-upload capability window and requires later service activity. No automatic cleanup schedule is configured.

## Brand Commitments

Supplied brief: cinematic dark interface, restrained violet/cyan accents, large thumbnails, mobile-first viewing, readable typography, explicit playback controls. User chose image mockups before UI code.

## Evidence on Hand

Original product, architecture and agent source documents are preserved in docs/vault. On2026-10-25 the user supplied THE CALL and TARU, attested permission to upload/distribute both and chose full-film support. Their measured durations fit the20-minute Movie limit, but both unchanged original files exceed the new active50MB Storage cap. Earlier500MB/multipart/TUS acceptance belongs to the dormant Stream implementation and does not make those originals eligible for the active path. No original file was modified, trimmed or transcoded. A generated two-second2870-byte MP4 proved actual local upload, pending human review and private native playback before exact cleanup; original account/content were preserved. No public catalog publication or creator endorsement is inferred, and no Cloudflare credential/plan/billing activation is required for the active Storage design.

## Product Principles

- Honest catalog results and visible AI disclosure.
- Guest access before onboarding.
- Direct uploads for verified users and human moderation before publication.
- Small provider boundaries and measurable costs.
- Accessible, understandable controls.

## Accessibility & Inclusion

Keyboard operation, visible focus, meaningful labels, reduced-motion support, comfortable tap targets, and clear preference language for older viewers. User-directed update on 2026-10-24: onboarding offers optional, self-described personal ethnicity with explicit consent and owner-private storage; it is never inferred, published or used for recommendations. Content-inspiration preferences remain a separate concept.

## Open Decisions

Catalog supply and licensed sample media; production provider accounts; operational budgets; retention periods; launch jurisdiction and professional policy review. These do not block local foundation work.
