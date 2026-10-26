# Hosted environment — production connected, email pending

[[Home]] · [[04 Operations/Runbook|Runbook]] · [[04 Operations/Supabase Agent Setup|Supabase agent setup]] · [[04 Operations/Cloudflare Agent Setup|Cloudflare agent setup]]

## Current development and production targets

The active development backend remains the isolated `aiverse-ana` project at `http://127.0.0.1:55321`, using ignored `.env.local`. The user subsequently authorized the reviewed hosted schema/taxonomy push and then the production Vercel connection to that existing hosted project. Production now uses only the public Supabase URL/publishable key; no local environment profile was activated or copied wholesale. Local development continues with explicit local CLI targets. See [[04 Operations/Local Development]], [[03 Delivery/Hosted Supabase Migration Verification]], [[03 Delivery/Production Supabase Connection Verification]] and [[02 Architecture/Decisions#ADR-015 — Local Supabase for now]].

## Supabase — retrieved and staged on 2026-10-24

The user authorized retrieving the environment credentials for project `YOUR_SUPABASE_PROJECT_REF`. The existing authenticated Supabase CLI retrieved that exact project's API keys without printing their values. The CLI's credential store was used normally; no Codex OAuth token was extracted or copied.

The ignored `.env.hosted.local` profile now contains the verified project URL, publishable/anon public keys, server-only service-role key and an internal worker secret. The app already supports `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Both legacy key roles were checked and their project claims matched. Requests to the exact project's Auth settings and service-authenticated REST schema endpoints returned HTTP 200.

`.env.hosted.local` is a staged profile, not a standard automatically loaded Next.js environment filename. The active `.env.local` was verified byte-for-byte unchanged, preserving the isolated local preview. Both filenames are excluded by `.gitignore`. The temporary raw-key retrieval file was removed after the profile was saved; no credential values appear in source, chat, this note or the safe result manifest.

## Hosted schema applied — 2026-10-25

The earlier retrieval found required application relations absent from REST metadata. The newly authorized push applied all 15 reviewed migrations in original order plus taxonomy-only seed. Independent read-only postflight ACCEPT confirms 31 RLS-enabled application tables, 26 policies, 58 functions, two allowlisted security-barrier public views, zero Auth users and empty non-taxonomy tables. Taxonomy contains 12 genres, 12 content regions and 17 languages; repeat dry run reports up to date. No reset, history repair, account/mock-film creation or application role grant occurred.

Security advisors report 42 unsilenced findings: two ERROR security-definer views, four WARN anonymous-executable and 36 WARN authenticated-executable definer functions. The existing projection/RPC design and read-only metadata checks are documented in [[03 Delivery/Hosted Supabase Migration Verification]], including remediation links. Schema ACCEPT is not a clean-security or complete hosted-runtime acceptance.

## Production public connection — 2026-10-25

The stable [production alias](https://ai-verse-sigma.vercel.app) now connects through production-only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. No service-role, worker or provider secrets were installed. The READY deployment uses unchanged GitHub source `91101b3d59ceca17c444d4fe498e65e8f8278bfc`. Earlier zero-environment/unavailable observations are historical and superseded for production only; the ignored `.env.hosted.local` remains staged/inactive and `.env.local` remains local.

Hosted Auth now uses that alias as Site URL and its `/auth/callback` as the additional redirect; the earlier list was empty. OTP length is six; confirmations remain enabled. Independent connection-only verification accepts the actual live empty catalog, enabled Email UI and guest private-API denials. It does not prove email delivery or account sessions. Runtime discovery always uses published records with honest empty/unavailable states; environment flags cannot restore mock catalog data.

## Pending SMTP and hosted account verification

The custom confirmation template was rejected HTTP 400 under the free/default email-provider restriction and was not applied. The four blank required SMTP fields observed on 2026-10-25 are historical.

As of 2026-10-26, ignored `.env.smtp.local` is prepared for Gmail using `smtp.gmail.com:587`, the supplied Gmail address for SMTP username/sender, and `AIVerse` as sender name. No private address or credential is recorded in these notes. The posted password was not used or stored, and the SMTP password field remains blank. The current gate is a newly generated Google App Password, created locally after 2-Step Verification and saved directly in the ignored file; the parent checked Google's official requirements.

Remote SMTP remains unconfigured, with no SMTP/Auth change, email or account created by this preparation. Delivery, code signup/verification, password login and session end-to-end checks remain unverified. Existing production connection-scope ACCEPT is unchanged.

Preserve both local environment profiles and the working local database. Stream remains disabled, and the 42 security-advisor findings remain open. Hosted Auth/JWT/cross-user functional testing, provider playback and full security/release acceptance need separate evidence. The connection result is in [[03 Delivery/Production Supabase Connection Verification]]; the subsequent hosted Google setup is recorded below.

## Hosted Google OAuth setup — 2026-10-26

Google is now enabled on hosted production through the dedicated AIVerse Web client with basic identity scopes. Its Console audience remains External/Testing; it is not published or verified. Authenticated CLI configuration retains nonce checks and requires email; unrelated remote Auth properties were preserved. Credentials are private in ignored `.env.google.local` and hosted Supabase only, with no Vercel/source credential copy. Local Google remains disabled; private comparison preserves all four existing environment/configuration hashes.

Independent setup verification ACCEPT confirms Google readiness, intended client/callback redirect chain and PKCE S256. Actual browser entry reaches Google's account chooser, where the parent stopped before account selection or consent. No completed login, token exchange, account creation or session is claimed. Zero listed test users does not itself block Google's documented identity-only exception; the scoped evidence and official reference are in [[04 Operations/Google OAuth Setup]]. SMTP App Password and actual email/signup/session verification remain separate pending work.

## Cloudflare — left unconfigured at the user's request

Cloudflare's MCP connection is registered and authenticated, but its new tools are not exposed in the current chat. No connected Cloudflare plugin was found. The user completed dashboard sign-in. The Account ID was retrieved from the visible authenticated account URL and saved in the staged profile; it is not sufficient to configure Stream by itself.

The account-token page showed no existing account tokens. A draft named AIVerse Stream test was prepared with Stream Write access to that account and a thirty-day expiry of November 23, 2026. The user explicitly chose **Leave Cloudflare unconfigured** at the required action-time approval. The draft was discarded without clicking Create token. Stream API-token and webhook-secret fields remain empty, and uploads remain disabled. The review screenshot records a declined draft, not an issued credential. Stream's video page did not render its main content, so no subscription status was inferred.

The webhook secret depends on registering a reachable authorized endpoint. No endpoint/tunnel, subscription, token, resource or billing change has been created by this environment retrieval. Optional signing-key placeholders remain unused by the current API-token signing implementation. An independent verifier accepted the staged Supabase profile, ignore coverage, safe credential handling and local-preview preservation; that acceptance does not certify hosted activation. Operational budgets, licensed media and provider verification remain in [[03 Delivery/Release Checklist]].
