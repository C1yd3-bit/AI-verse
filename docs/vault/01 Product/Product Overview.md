# Product overview

[[Home]] · [[03 Delivery/Roadmap|Roadmap]] · [[02 Architecture/Decisions|Decisions]]

## Purpose
AIVerse helps people discover authorized AI-created reels and short films through a public catalog, human-reviewed publication and Fusion: content inspiration/region × genre × format. Search returns actual catalog records and gives honest empty results.

## People and permissions
- Guests browse published content and use unsaved Fusion.
- Viewers save interests, like/follow, report content, save Fusion and use a private account library through locally implemented interfaces and APIs.
- Approved creators submit their own media within configured limits.
- Moderators review videos and reports. Only administrators approve creators or grant roles.

## MVP boundaries
The local MVP now implements Next.js App Router, TypeScript, Tailwind, Supabase Auth/Postgres/RLS, a server-only Stream adapter, creator/studio/moderation and account-library interfaces, published catalog/tag/creator discovery and trust controls. Local SQL and actual local Auth/PostgREST verification support these claims; no real Cloudflare upload or playback has been exercised.

Payments, ads integration, revenue claims, AI video generation, paid LLM dependencies, automated moderation, longer uploads and native apps are deferred. Local Mailpit confirmation and PKCE callback have been exercised; external SMTP and hosted identity remain unconfigured/unverified.

## Product contracts
1. Guest browsing requires no account or onboarding.
2. Completed onboarding selects 5–8 genres; content-region interests are optional. Skipping stores an explicit skipped state and empty preferences. Settings can revise this later.
3. Content-region labels describe inspiration in the content, never personal ethnicity.
4. Fusion uses OR within each multi-select dimension and AND across dimensions. Global/Any means no region restriction.
5. Initial Movies means short films; proposed per-upload maximum remains three minutes until a policy change.
6. Only approved, processed and human-reviewed media may become publicly playable.
7. Development fixtures and unavailable media are clearly labeled. No fabricated live playback, popularity or revenue.

## Design direction
Cinematic dark interface with restrained violet/cyan accents, large thumbnails and readable typography. Mobile viewing and explicit playback controls come first. The user requested an image mockup before UI implementation and most recently approved direction A: left sidebar, one wide featured film, horizontal Fusion controls and a three-film shelf, without a carousel. Keep source mocks in `.impeccable/mocks` and the approval/direction in the root surface brief.

Final human artwork/component acceptance and the recorded Impeccable method gate remain open. After explicit human approval limited to isolated `aiverse-ana`, two disposable personas exercised creator application/approval, saved Fusion, draft revision/rejection, suspension/appeal and administrator Operations. Fourteen valid desktop 1440/mobile 390 captures were opened by parent and independent finish reviewer with no overflow or material visual blocker in observed states. Both accounts/dependent records and temporary credentials were removed. The earlier approval blocker is resolved; moderator-only browser and actual provider/player coverage remain distinct limitations. See [[03 Delivery/Authenticated Browser Verification]].

## MVP evidence
Actual local verification includes captured-mail confirmation → PKCE callback → account preferences/logout, owner-isolated library save/delete, real four-way concurrent upload reservation requests, version-bound publication and hide/replay denial with simulated provider facts. Recommendation freshness uses trusted publication timestamps and owner feedback over a bounded candidate pool; its weights remain hypotheses. Final combined checks and independent acceptance belong to reviewer evidence. Beta additionally requires licensed real playback, hosted service verification, operational policy and a real cohort. See [[03 Delivery/Roadmap]] and [[03 Delivery/Release Checklist]].
