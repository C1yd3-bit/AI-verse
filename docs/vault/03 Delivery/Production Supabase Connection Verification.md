# Production Supabase Connection Verification

[[Home]] · [[03 Delivery/Roadmap|Roadmap]] · [[03 Delivery/Build Log|Build log]] · [[04 Operations/Hosted Environment|Hosted environment]] · [[03 Delivery/Hosted Supabase Migration Verification|Hosted migration verification]]

2026-10-25. The production Vercel app is connected to the migrated hosted Supabase project. Independent verification returned **ACCEPT for the production public connection and guest boundaries**. Email delivery, signup and authenticated sessions remain **UNVERIFIED** because custom SMTP is not configured. This is a bounded connection milestone, not whole-release acceptance.

## Production configuration and deployment

Only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` were installed for the production Vercel environment. No Supabase service-role, worker or provider secret was uploaded, and preview/development environments were not connected by this step. The earlier zero-Vercel-environment and unavailable-service observations are historical and superseded for production only.

The redeployment is **READY**, targets **production**, and uses the unchanged `main` source commit [91101b3d59ceca17c444d4fe498e65e8f8278bfc](https://github.com/C1yd3-bit/AI-verse/commit/91101b3d59ceca17c444d4fe498e65e8f8278bfc). Its stable alias is [ai-verse-sigma.vercel.app](https://ai-verse-sigma.vercel.app). No source commit or push was performed for the connection.

The parent aligned hosted Auth settings with the existing app flow:

- Site URL: `https://ai-verse-sigma.vercel.app`.
- Additional redirect URLs: `https://ai-verse-sigma.vercel.app/auth/callback`; the previous list was empty.
- Email OTP length: six digits.
- Email confirmations: remain enabled.

CLI 2.122.0 applied the narrow Auth changes using a scratch configuration. The final comparison reported zero applicable updates; six remote-only differences were intentionally preserved. The local application environment profiles and project configuration were not changed.

## Actual public and guest checks

The independent reviewer made 14 cookie-free HTTPS GETs without authentication headers or mutations:

| Check                   | Result                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------- |
| Published catalog API   | HTTP 200, mode `live`, zero exact/broader records                                                             |
| Home                    | HTTP 200, honest empty catalog and no mock titles                                                             |
| Login/signup pages      | HTTP 200, configured Email UI with no account-service-unavailable message                                     |
| Auth provider readiness | Email confirmation enabled; Google unavailable                                                                |
| Eight private APIs      | All HTTP 401 for guests: onboarding, profile, preferences, avatar, library, Studio, moderation and operations |
| Callback without a code | HTTP 307 to `/login?error=confirmation`                                                                       |

Separate parent checks confirmed 12 public genres, an empty public catalog and anonymous private-profile denial. Malformed signup, a five-digit code and invalid JSON each returned HTTP 400; a cross-origin request returned HTTP 403. These validation checks submitted no valid signup request or credentials and triggered no email action.

The parent also inspected the actual desktop browser: Home shows an honest empty catalog, Email and its form are enabled, and Google remains disabled. No credentials were entered or email sent. Hosted counts remain zero Auth users, zero videos and zero public catalog records. Browser evidence and raw reports remain outside the public repository.

## Email delivery gate

The attempt to install the custom confirmation-email template returned HTTP 400 because the hosted free/default email provider restricts that customization. The template was **not applied**. A six-digit OTP setting and enabled Email form do not prove that the app's code-email signup journey works.

At the 2026-10-25 check, the required SMTP host, username, password and sender values were blank. That observation is historical; the preparation below supersedes the four-blank-fields gate.

Update 2026-10-26: Gmail SMTP host `smtp.gmail.com`, port `587`, the supplied Gmail address as username/sender, and sender name `AIVerse` are prepared in ignored `.env.smtp.local`. Private address and credential values are not reproduced here. The posted password was not used or stored; the SMTP password field remains blank. The remaining input is a **new Google App Password**, generated locally after enabling 2-Step Verification and saved directly to the ignored file. Google's official requirements were checked by the parent.

Custom SMTP remains **UNCONFIGURED remotely**. Preparing local settings did not change Supabase, send an email or create an account. Connection-scope ACCEPT is unchanged; no delivery, resend, signup, verification, password login or session end-to-end success is claimed.

## Preserved boundaries and remaining work

Local `.env.local`, staged `.env.hosted.local` and project configuration remain untouched. Existing local development data/accounts were retained. No SQL, local database/account, email, role or provider mutation occurred as part of the connection checks. Stream remains disabled, Google is unavailable, and all **42 hosted security-advisor findings remain OPEN** as recorded in the migration review.

Hosted SMTP configuration and the required confirmation template still need successful application and actual delivery/signup/session verification. Hosted Auth/JWT/cross-user workflows, provider media and full security/release acceptance remain separate gates. These documentation edits are local; no Git commit, push or additional deployment is performed by this note.
