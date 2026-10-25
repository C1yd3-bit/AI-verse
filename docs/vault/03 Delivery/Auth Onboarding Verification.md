# Auth and onboarding verification

[[Home]] · [[02 Architecture/Account Onboarding]] · [[03 Delivery/Verification]]

Independent verifier, 2026-10-24. Scope: the new local authentication and private account-onboarding backend. Frontend composition, browser accessibility, real Google OAuth and public release are separate gates.

## Current disposition

**ACCEPT for this bounded local backend slice.** Independent source/automated checks and the builder-reported real local captured-code integrations support this verdict. This is not acceptance of the frontend, complete current goal or overall release.

The verifier inspected migrations 009 and 010, auth request/guard/provider-settings services, signup/login/verification/resend routes, Google entry and PKCE callback, account destination selection, and the private onboarding API/RPC. No further material backend defect was found in the reviewed scope.

## Independent evidence

Command run after migration 010 and the explicit API length refinements:

```text
npx vitest run tests/auth-onboarding-routes.test.ts tests/account-onboarding-rls.test.ts tests/auth-settings.test.ts tests/backend-validation.test.ts
29 tests passed in 4 files
```

The SQL tests execute the actual migrations 001–010 in PGlite with emulated Supabase identity and confirmed-email state. Route/provider tests mock upstream Auth and database responses; they do not establish real OTP delivery or Google sign-in.

| Criterion | Independent result | Evidence and limit |
| --- | --- | --- |
| Confirmation required before private onboarding | PASS | Signup fails closed if Auth settings permit automatic confirmation; unexpected confirmed/session signup results are signed out. API rejects unverified users, and SQL independently checks the actual `auth.users.email_confirmed_at`. |
| Six-digit confirmation and safe errors | PASS | Strict six-digit input, generic provider failure messages and no OTP returned by the API. The delivered-email template now contains the code without a confirmation-link fallback. Builder reports actual captured-code verification and cookie establishment passing. |
| Expiry, resend, superseded code and replay | PASS, builder runtime | Dedicated real local integration passes wrong-code denial, expired captured-code denial, resend recovery, superseded-code denial and used-code replay denial. Expiry was simulated by backdating only the exact new unconfirmed fixture's challenge timestamp; a natural one-hour wait was not performed. Route tests also cover provider errors and resend rate limits. |
| Google readiness and PKCE destinations | PASS, source/unit | Provider settings are fetched with the public key, bounded body, timeout and no cache. Unconfigured Google returns 503. The installed SSR client uses PKCE; entry accepts only the configured Supabase authorization origin/path, callback destination is always `/onboarding` or `/dashboard`, and arbitrary `next` is ignored. No real Google login is claimed. |
| Owner-private profile information | PASS | No direct account writes are granted. Anonymous RPC/read and other-account reads/writes are denied, including an administrator reading a different account. The RPC derives identity from the session and rejects ownership injection. |
| Explicit optional ethnicity consent and revocation | PASS | Description requires affirmative consent; omission requires false consent. Revocation clears description and consent timestamp. Optional contact can also be cleared. |
| Private name and ethnicity absent from public/ranking inputs | PASS | SQL projection test preserves the separate public display name and excludes private fields. Source inspection found no account-details/ethnicity input in discovery or recommendations. |
| Atomic preferences and profile | PASS | One owner-derived SQL transaction validates shared interests and saves account details. Invalid interests or length overflow leave saved fields unchanged; failed API saves permit retry. |
| Boundary checks cannot be bypassed by direct RPC | PASS | Strict fields/types, age, phone plausibility, consent, taxonomy/cardinality and unknown-key rejection are checked in API and SQL. Migration 010 also enforces full-name/ethnicity UTF-16 limits through API, RPC and table constraints; 41/51-emoji overflow regressions pass. |
| Existing/new account destination | PASS, source/unit | Owner-scoped completion lookup routes completed accounts to `/dashboard`; missing completion or query errors do not skip onboarding. |

## Review correction

An initial verifier assumption that installed Zod `.max()` counted UTF-16 units was incorrect. Zod 4.6.7 counts Unicode code points, so migration 009's `char_length` matched its original server behavior. This was corrected before acceptance. Migration 010 and explicit `value.length` refinements intentionally adopt shared UTF-16 bounds to align with HTML `maxlength`; they are not evidence of an original Zod/SQL mismatch.

## Runtime and remaining gates

The builder reported both commands passing after migration 010 and the code-only email-template change:

```text
node tests/local-onboarding-integration.mjs
node tests/local-integration.mjs
```

The new integration uses the real isolated local Supabase Auth/PostgREST stack, captured Mailpit code and app cookie endpoints. It checks no signup session/password-only bypass, wrong/expired/superseded/replayed-code denial, resend recovery, private profile/interests persistence, another-account/anonymous denial, ownership injection, invalid-preference rollback, returning login to dashboard and clearing optional contact/ethnicity/consent timestamp. The existing integration retains preferences, Library isolation and query-column coverage. These commands were run by the builder, not repeated by this verifier while it owned the fixtures. Neither integration used a hosted project or external email.

Afterward this verifier independently ran a read-only aggregate query inside `supabase_db_aiverse-ana`: both migration-history versions 009/010 were present; temporary `onboarding-*` Auth-user count was zero; matching account-detail count was zero. This verifies removal of the dedicated integration users; it is not a claim that all database records are empty. The builder separately reported exact-fixture cleanup for both integrations. No fixture account, environment, schema, secret or product source was changed by this verifier.

Pending frontend/browser review and the parent-wide typecheck, lint, build and full-suite result remain outside this bounded automated verdict. Age 1–120 is a plausibility bound, not age verification or an eligibility policy; contact is not SMS verification. Google setup, sensitive-data policy/retention, real provider/licensed-media evidence and the existing human artwork/method/release gates remain open.
