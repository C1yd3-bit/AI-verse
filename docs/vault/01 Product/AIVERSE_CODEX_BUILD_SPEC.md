# AIVerse — Codex Build Specification

## Mission
Build a production-minded MVP for **AIVerse**, a web-first AI-generated video entertainment platform. It is a YouTube/TikTok-inspired catalog focused on authorized AI-created content. Its distinguishing features are: approved creator onboarding, trustworthy video moderation, AI-powered natural-language discovery, personalization, and **Fusion** (mix a cultural/regional content style with a genre, plus format filters).

**Execution instruction for Codex:** Inspect the repository first. If the repo is empty, initialize the application. Implement in working vertical slices with migrations, RLS, tests and setup instructions. Do not claim external accounts or secrets are configured. Where credentials are missing, create environment-variable examples and functional mock/dev adapters. Never overwrite unrelated projects. Explain commands, blockers, and changed files at the end of each slice.

## Product principles
- Anyone can watch public videos without an account; registered viewer profiles can persist preferences, follows, likes and saved Fusions.
- Free creator applications. Only approved creators can upload. Admin invitation path for early creators.
- Public uploads are disabled in initial MVP. Every video must be approved by a moderator/admin before public playback.
- Creators own or have licensed rights to uploaded media; provide rights attestation and AI-generated disclosure.
- No paid plan needed to earn creator monetization in future; creator subscription and payouts are OUT OF SCOPE for initial MVP.
- Videos MUST be real catalog records; AI search must never fabricate results.
- Keep preferences about **content's cultural inspiration/region**, not the viewer's or creator's ethnicity. Separate content region, language, genre and setting; do not infer protected identities from faces.
- Mobile-first vertical feed, desktop-friendly navigation, keyboard accessibility and accessible labels.
- No auto-generated video creator in the MVP. Do not download/repost social videos without rights.

## Recommended tech stack
- Next.js App Router + TypeScript + Tailwind CSS, UI component library chosen to fit existing repo (e.g. shadcn/ui)
- Supabase Auth + Postgres + row-level security (RLS), optional pgvector for search
- Cloudflare Stream for direct-upload, encoding, delivery; private review playback via signed tokens
- Vercel-compatible deploy, Resend invitation/status emails (optional mocked dev adapter)
- Stripe/AdSense **not integrated in phase 1**; only ad-slot placeholders and usage analytics
- Zod for server-side validation, basic testing (Vitest or existing), Playwright for key workflows where feasible
- Avoid additional paid AI services for MVP. Implement hybrid keyword/filter search first, with clean interface for later embeddings/LLM.

## Navigation and routes (suggested)
Public:
- `/` personalized or editorial home, popular/just added, Fusion controls
- `/reels` vertical swipe/scroll short-video player with one active stream, conservative preload
- `/movies` longer-form content catalog
- `/watch/[id]` shareable watch page
- `/search` classic and natural-language search
- `/fusion` interactive culture/region + genre + format mixer; supports URL query parameters
- `/tag/[slug]` hashtag discovery
- `/channel/[handle]` creator page
- `/login`, `/signup`, `/onboarding`, `/settings/interests`
Creator:
- `/creator/apply` application with sample portfolio URL
- `/studio` upload status and basic analytics
- `/studio/upload` uploader and metadata editor
- `/studio/videos/[id]` video status and edits
Admin/moderation:
- `/admin/creator-applications` review, approve/deny and invite
- `/admin/videos` processing/review queues; private preview; approve/reject with reason
- `/admin/reports` reported content review
- `/admin/audit` audit log

## User roles / permissions
Roles are additive: `viewer`, `creator`, `moderator`, `admin`; use a `user_roles` join table.
- Guest: view published, search, Fusion (unsaved).
- Viewer: guest rights + choose interests (5–8 genres recommended), optional content-region interests, like/follow, save Fusion and report.
- Creator: viewer rights + upload drafts after admin approval, view own private videos, analytics.
- Moderator: review content and reports; never grant self privileges.
- Admin: approve creators, manage invites/reports/content and limits.
- Server checks and RLS both enforce authorization. Never expose service-role or Stream tokens client-side.

## Viewer onboarding
After viewer sign-up: Step 1 choose 5–8 genres from a configurable list (Fantasy, Sci-Fi, Comedy, Horror, Animals, Action, Romance, Mystery, Anime, History, Nature, Wholesome). Step 2 optionally choose multiple **cultural/regional content interests** (Korean, Chinese, Filipino, Japanese, Indian, Thai, Vietnamese, Turkish, American, British, Mexican, Global/Any). Copy should explicitly clarify these are **content preferences, not personal ethnicity**. Skip option for guests/viewers who simply want to watch. Editable in Settings. No forced age, gender or ethnicity questions.

## Fusion: primary differentiator
Viewer picks: 1 or more content-region/style tags (or Global), 1 or more genres (single in simplest MVP), and format (`all`, `reels`, `movies`). Render true matches from published catalog, sortable by recommendation/recency. Save combinations for signed-in viewers; guests can explore without saving. Sync selections to shareable `/fusion?region=korean&genre=romance&format=reels`. If few exact matches, show actual matches first and distinctly labeled broader suggestions; do not pretend results exist. AI assistant should be able to translate conversational requests into Fusion filters.

## Creator onboarding and uploads
Viewer creates account -> applies with public display/handle, bio, category, sample portfolio URLs, rights acknowledgment -> status pending -> admin accepts/rejects with reason -> creator dashboard enabled. Admin invites by email (optional).
Start free creators with **proposed policy**: max 3 videos/day, 30 minutes cumulative video upload allowance per month, individual video <= 3 minutes, with configurable admin override. Treat all as config, not immutable business constants. Limit file sizes and MIME types, uploads per hour, and accounts. Creator Pro at CAD 9.99/mo, higher limits, advanced analytics: **future only**.
Uploader collects title, description, category/genre(s), up to 10 normalized relevant hashtags (suggest 3–5), optional region/style(s), actual language(s), AI generation tool(s), video format, thumbnail, and a mandatory rights attestation/AI disclosure. Separate `reel` vs `movie` presentation; retain duration validation without assuming long movies are enabled for free uploads on day one.
Status: `draft -> uploading -> processing -> pending_review -> published`; `failed`, `rejected`, `hidden`, `removed` as alternatives. Cloudflare direct upload URL from secured API after quotas/role checks; browser uploads to Cloudflare. Webhook from Cloudflare must verify authenticity where supported, or reconcile processing from server-side provider API; do not trust browser flags. Ensure private video cannot be watched publicly while in review. Use secure signed playback for private previews. Track upload costs and total minutes. Rejected media lifecycle and deletion policy required.

## Hashtags and discovery
`hashtags` normalized unique slugs, `video_hashtags(video_id, hashtag_id)` unique composite; case insensitive uniqueness and sanitization. Searchable `/tag/[slug]`. Auto tag suggestions may come from existing tags and description (rule-based first, LLM optional). Tags are just one ranking input; tag stuffing never improves rank.

## AI helper — discovery assistant
UI: prominently visible natural-language query on home/search, compact shortcut on Reels. User examples: “cat cooking spaghetti”, “Korean romantic reels under 2 minutes”, “Filipino horror in Tagalog”, “more like this”. Parse filters (genre, region, duration, format, hashtags, languages) then retrieve only published actual videos from indexed catalog. V1: SQL full-text + exact metadata filters, deterministic parsing/rule-based extraction for common filters. Expose a clean `searchVideos(query, filters)` service so embeddings, pgvector and an LLM intent parser can be added when keys/budget exist. Explanations should be grounded in catalog tags/descriptions. No invented video titles; clear empty-result states.

## Recommendation ranking
Onboarding genres and regional interests supply initial preference signals. Mix watch completion/retention, user interest, hashtag relevance, meaningful engagement, freshness and creator diversity, but do not ship arbitrary weights as evidence-based; use simple transparent weights configurable via code. Provide 20% exploratory content as a proposed starting value, measure actual retention. Prevent repeated clips, bot-like views and autoplay amplification. ‘Not Interested’ is a negative signal and should update personal preferences. Stream one active video at a time, prefetch cautiously to control billable delivery minutes.

## Suggested SQL tables (migrations + RLS)
`profiles`, `user_roles`, `creator_profiles`, `creator_applications`, `creator_invites`, `genres`, `content_regions`, `languages`, `videos`, `video_genres`, `video_content_regions`, `video_languages`, `hashtags`, `video_hashtags`, `viewer_genre_preferences`, `viewer_region_preferences`, `user_saved_fusions`, `likes`, `follows`, `watch_events`, `reports`, `moderation_actions`, `audit_logs`.
Use foreign keys, appropriate unique constraints/check constraints/indexes and immutable auditing. `videos` should include owner, Stream UID, status, title, description, type, duration, processing timestamps, published timestamp, and AI disclosure. RLS: published video metadata public, own drafts visible to owner, moderator/admin see queues; profile preferences visible to owner. Public API must not expose private playback IDs that grant access.

## Core APIs / actions
- session/profile and onboarding update
- creator application submit/get/admin decision
- secure Stream upload authorization, complete/reconcile status, provider webhook handler
- save/update video metadata, moderation publish/reject/remove
- browse/search/feed/Fusion, saved fusions CRUD, hashtags
- likes/follows/watch events and not-interested
- report content/admin resolve
All mutations validate input (Zod), identity, role, ownership, and rate limits; avoid service-role use in frontend.

## Design direction
Cinematic dark theme with optional light mode, restrained violet/cyan accent, large video thumbnails, mobile-first reel immersive mode. Home: editorial hero + "For You", saved Fusion chips, Trending Tags, Reels and Movies shelves, AI search input. Uncluttered UX for older viewers: readable fonts, clear playback controls, tap targets, explicit autoplay/mute controls. Accessibility and loading/empty/error states must be usable.

## Moderation & trust
Admin-review ALL initially. Reporting, repeat offender controls, content rights attestation, AI-generated labels, synthetic impersonation and deception restrictions, sexual/violent content policy, copyright takedown and appeal workflow. Avoid intrusive collection of sensitive ethnicity/identity. Include terms/privacy/community guidelines placeholders with clear TODO for professional legal review before public launch.

## Analytics and launch gates
Event funnels: visit -> watch -> second watch -> return in 7d; onboarding completion; creator application -> approval -> first approved upload; median playback start; watch retention; Stream delivered/storage minutes; moderation turnaround; estimated ad impressions (no fabricated ad revenue). Build admin cost dashboard where possible. Private beta ~10–20 approved creators and ~100–200 authorized videos before pushing promotion. Run security reviews, video playback tests, quotas and abuse tests before wide launch.

## Delivery phases
1. **Foundation:** scaffold, style system, DB migrations/RLS, demo seed videos and fake media URLs only in dev with clear tags, public pages + auth + onboarding.
2. **Core viewing:** reels, movies, watch, search, hashtags, Fusion + saved Fusion, responsive/mobile accessibility, no fabricated real data.
3. **Creator workflow:** application, admin approval, upload authorization, processing state, moderation and private previews, reporting.
4. **Beta hardening:** telemetry, quotas, watch events, recommendation tuning, creator dashboard, CI/security/performance and deploy docs.
5. **Later (do not prematurely build):** real LLM embeddings, premium/viewer subscriptions, Creator Pro, creator payouts, video ad network integration, creator revenue share, automated visual content classification, native apps.

## Acceptance criteria for MVP
- Guest can explore public catalog, Reels, Movies, Tags, Fusion and search without signing in.
- Signed-in viewer can choose 5–8 genres and optional cultural content preferences; settings persist.
- Fusion with region+genre+format returns only real published matches; supports saved combinations and no-result fallbacks.
- Creator cannot upload without approval; approved creator can upload within quotas.
- Cloudflare direct upload is secure; processing and video moderation gates before public playback.
- Admin can approve/reject creators and videos with audit trail and reason.
- Normalized hashtags are searchable, and AI-like descriptive search works without requiring a paid LLM.
- User reporting and moderation functionality work; RLS prevents exposure of private drafts.
- Project includes `.env.example`, setup instructions, migrations, seed/demo mode, unit tests for authorization and ranking/filtering, and a sensible deploy checklist.

## First Codex task
Inspect repo, propose a concise implementation plan, then implement **Phase 1 / Slice A**: Next.js foundation, design shell with home/reels/movies/fusion placeholders, Supabase schema migrations and RLS for auth/profiles/roles/genres/content regions/preferences, genre + region onboarding and editable viewer settings. Include demo fixtures and setup guide. Run available tests/typechecks. Do not attempt external service configuration without credentials. Continue slice by slice once the foundation is verified.
