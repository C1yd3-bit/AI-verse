# Account authentication and onboarding

[[Home]] · [[02 Architecture/Decisions|Decisions]] · [[03 Delivery/Roadmap|Roadmap]]

## Current slice: locally implemented and verified; formal method gates open
The user selected mock B, Cinematic split, for authentication/onboarding, then amended its artwork column to a carousel using catalog thumbnails. This applies only to auth/onboarding. Home retains A without a carousel. Backend and UI are implemented; local integration and the observed browser journey pass. Independent backend verdict is ACCEPT; auth design disposition remains FIX solely for static-plate/method persistence, with no remaining material UI repair. See [[03 Delivery/Auth Onboarding Verification]], [[03 Delivery/Auth Onboarding Design Review]] and [[03 Delivery/Auth Design System Check]].

## Authentication contract
Email/password signup proceeds to six-digit email OTP verification with resend. The local confirmation email is code-only, without a fallback link. Existing users sign in with their password. Real local integration proves wrong, fixture-timestamp-expired, superseded and replayed codes are denied; resend recovers. Local Mailpit captures messages. These new OTP checks supersede earlier confirmation-link evidence for this flow; they do not prove external SMTP.

Google uses Supabase's PKCE OAuth path only when provider readiness is confirmed. Missing local Google configuration must produce an honest unavailable state. Google Console OAuth consent/client configuration, Supabase provider enablement/secrets, exact authorized origins/redirects and real end-to-end sign-in remain external setup/verification gates. No Google credentials or working external Google login are claimed.

## Private account details
Migrations 009/010 and `complete_account_onboarding(payload)` implement owner-private account information. Both migrations were applied transactionally with history only to isolated local `aiverse-ana`; its existing volume was preserved through two template-loading restarts. The server/database derive identity from the session and require confirmed email. Account data and interests commit atomically. Direct writes are revoked; verified-owner reads and anonymous/cross-user denial have local tests, including invalid-preference rollback and consent revocation.

- Full name is private and is never copied into public `profiles.display_name`, creator projections or catalog metadata.
- Integer age from 1 to 120 is a plausibility bound only. It establishes no eligibility, age-verification, child-safety or legal consent policy; those remain explicit policy work.
- Contact number is optional, bounded and format-validated; no SMS verification or delivery is implied.
- Preferences reuse the shared five-to-eight valid unique genres plus optional content inspirations, or an explicit skip with empty selections.
- Personal ethnicity is optional self-description, separate from content inspiration. A nonempty description requires affirmative explicit consent and a private consent timestamp; no description requires false consent and cleared consent data. It is never inferred from names/faces, made public or used in discovery/recommendation ranking.

The optional personal ethnicity field is a user-requested change to the original no-collection direction, captured in ADR-016. Do not expand its use or silently merge it with content-region taxonomy. Retention, access review, correction/deletion and legal/minor-handling decisions need accountable approval before real public collection; no new launch policy is invented here.

## Routing and verification gate
Account completion routes to the dashboard; missing completion or database errors do not skip onboarding. Current parent checks pass: 153 tests across 19 files, typecheck, lint, formatting, production build with 36 generated pages and 28 HTTP smoke checks, including streamed Next.js login-denial states. Dedicated onboarding and updated existing local-account integrations pass. Exact cases and bounded verdict belong to the independent verification report.

Observed browser evidence at mobile 390/desktop 1505 covers signup, wrong/correct Mailpit code, name/age/contact, five genres, Back, optional ethnicity skip, awaited save, named dashboard, edit/reload and logout to guest Log in. Fourteen valid account captures include label fixes: Password and Verification code each match exactly one accessible control. The first journey account and second fresh unconfirmed label-recapture account, their private profiles/messages and temporary credentials were removed. Exhaustive keyboard and reduced-motion runtime behavior were not exercised; those mechanisms were checked in source only.

Google readiness is actually false; no OAuth start or external login is claimed. The detector has 41 advisory/zero nonadvisory findings and global tokens were preserved by the design-system check, but static plate/method persistence remains unresolved. Existing provider, human artwork, policy and overall release gates remain open; formal acceptance belongs to root STATE.md and reviewer notes.
