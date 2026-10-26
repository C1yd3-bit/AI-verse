# Google OAuth Setup

[[Home]] · [[04 Operations/Hosted Environment|Hosted environment]] · [[03 Delivery/Production Supabase Connection Verification|Production connection]] · [[03 Delivery/Roadmap|Roadmap]]

2026-10-26. The user explicitly requested Google Console OAuth setup and the hosted Supabase Google provider. **Setup verification ACCEPT**: the hosted provider is enabled and the production sign-in entry reaches Google's account chooser. The browser stopped before account selection or consent; user-completed sign-in and session creation remain **UNVERIFIED**.

## Authorized Google Console preparation

After an initial automatic-review block, the user explicitly approved creating a separate AIVerse Auth project, using one project-quota slot without billing activation. The user then approved the Google API User Data Policy submission, Web OAuth client creation and private credential storage for the hosted Supabase provider. The scope is basic identity only.

The parent used the selected signed-in Google account and created the dedicated AIVerse project rather than modifying the unrelated existing project. Branding is **AIVerse**; the audience is **External**, with publishing status **Testing** and zero explicitly listed test users. The app was not published or submitted for verification. The selected account supplies the contact information, which is intentionally omitted from public documentation.

A Web application client named **AIVerse Production Web** was created successfully with:

- Authorized JavaScript origin: `https://ai-verse-sigma.vercel.app`.
- Authorized redirect: the intended hosted Supabase project's `/auth/v1/callback`, in the form `https://<project-ref>.supabase.co/auth/v1/callback`.

The exact scoped callback was configured in Console. The parent saved only `userinfo.email`, `userinfo.profile` and `openid` data-access scopes and observed the save confirmation. This note omits the infrastructure identifier, client ID, secret and private contact address. Client credentials are stored privately in Git-ignored `.env.google.local` for the CLI and hosted Supabase provider, not Vercel or public Git.

## Hosted provider status

The Supabase browser session expired during setup; the authenticated CLI successfully applied the Google provider's client ID, secret, enabled flag and `skip_nonce_check=false`. The provider group also set `email_optional=false`, requiring an email. Nine unrelated remote properties were preserved. Final comparison showed zero pending updates and zero local-only differences; secret output remained masked.

Private hash comparison confirmed `.env.local`, `.env.hosted.local`, `.env.smtp.local` and `supabase/config.toml` were preserved. Google is available on hosted production only; local Google remains disabled. No source change, Git commit or redeployment was required.

## Independent and browser verification

Independent setup verification returned **ACCEPT**. Existing PKCE preflight passed 16 tests. Actual production checks confirm provider readiness HTTP 200 with Google enabled, login HTTP 200 with the Google entry, and an app HTTP 307 redirect to the intended Supabase authorization endpoint with the exact application callback and PKCE S256. Supabase then returned HTTP 302 to Google with the intended client digest and hosted callback. Runtime authorization requests only identity `email`/`profile` scopes. Three guest private API checks returned HTTP 401; a missing-code callback returned HTTP 307 to confirmation recovery. Public checks also retain email confirmation, 12 genres, an empty catalog and private-profile denial.

The actual production browser showed Google enabled. Clicking it reached Google's account chooser requesting authorization for the Supabase domain. The parent stopped before selecting an account or granting consent. Final hosted read-only counts remain zero Auth users, zero videos and zero public catalog rows. No login, token exchange, hosted account creation or email occurred. Private screenshots and raw verification reports remain outside public source.

Google documents an exception for identity-only `userinfo.email`, `userinfo.profile`, `openid` or equivalent Sign in with Google requests: users need not be on the test-user list, and the usual Testing warning/seven-day authorization expiry does not apply. Zero listed testers therefore does not itself establish a blocker for this minimal identity flow. Account/organization restrictions may still apply. [Google's audience documentation](https://support.google.com/cloud/answer/15549945)

## Remaining verification and separate gates

A real user-completed Google sign-in, callback token exchange, session and onboarding remain unverified. Setup ACCEPT is not full hosted Auth or release acceptance. Testing status remains explicit; no production consent publication, broader Google API access or billing activation is claimed.

SMTP remains a separate task. Gmail host, port, username/sender and display name are prepared privately; a newly generated Google App Password is still missing. Remote SMTP and code-email delivery remain unconfigured/unverified. Stream remains disabled, and all 42 hosted security-advisor findings remain open.

This documentation task changes no environment, source, database, provider configuration, Git commit or deployment. Parent-owned setup evidence and private credentials remain outside public source.
