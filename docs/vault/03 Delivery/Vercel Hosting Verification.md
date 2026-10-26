# Vercel Hosting Verification

[[Home]] · [[03 Delivery/Roadmap|Roadmap]] · [[03 Delivery/Build Log|Build log]] · [[03 Delivery/GitHub Release Verification|GitHub source verification]]

2026-10-25. The user requested importing the existing [C1yd3-bit/AI-verse repository](https://github.com/C1yd3-bit/AI-verse) into Vercel and approved workspace access through Vercel's consent page. The Git-linked `ai-verse` project was created with Next.js and Node 24.x. Its initial deployment is **READY**, with the deployment API confirming **target: production**.

## Deployment and source

- Stable project alias: [ai-verse-sigma.vercel.app](https://ai-verse-sigma.vercel.app).
- Immutable deployment: [initial Vercel deployment](https://ai-verse-3pqjl1mmj-casperchavez08-6890s-projects.vercel.app).
- Git branch: `main`.
- Exact deployed source: [91101b3d59ceca17c444d4fe498e65e8f8278bfc](https://github.com/C1yd3-bit/AI-verse/commit/91101b3d59ceca17c444d4fe498e65e8f8278bfc).

The initial creation response described the deployment as a preview. The subsequent deployment record's actual production target is authoritative. Independent read-only verification returned **ACCEPT** for the repository link, exact source commit and successful build. Inspected build logs report “Build Completed” in 27 seconds and “Deployment completed.”

The reviewed source already passed GitHub CI, including 603 tests and the 40-page production build. This import changed hosting configuration rather than application source; no new application tests or local build were required for these delivery notes.

## Observed hosted behavior

The parent opened the stable alias in the user's normal signed-in Vercel browser session and observed the actual AIVerse Home page. It displayed **“The catalog is unavailable.”**, with no sample images. This is consistent with the published-only runtime and missing hosted database configuration. Subsequent cookie-free HTTPS requests to `/` and `/login` both returned HTTP200 and the actual catalog/account-unavailable messages. The production alias therefore serves these pages anonymously; project-level protection does not imply every alias requires a Vercel login. Hosted account functionality remains unverified.

The parent also opened `/login` and observed the real split layout with the explicit message: “Account services are unavailable. You can keep browsing and return later.” Email and Google buttons were disabled; no credentials were submitted. Google's disabled helper retains inherited “local preview” wording, so this is a bounded availability check, not production-copy or full hosted-account acceptance.

Vercel's default SSO deployment protection remains `all_except_custom_domains`. No protection setting was relaxed or bypass link published. No successful hosted login, signup, onboarding or saved-account operation is claimed.

## Service boundary

The parent inspected project environment metadata with decryption disabled; it reported zero environment keys and zero hidden production variables. Local environment secrets were not copied. Supabase remains local, so this deployment has no configured hosted catalog or account service. Cloudflare Stream remains disabled and no supplied film was uploaded or published.

This import did not provision a hosted database, enable Stream, change billing, upgrade a plan, alter deployment protection or mutate existing local accounts/data. Hosted Supabase configuration and authentication, real catalog publication, provider processing/playback and broader release acceptance remain separate work.

## Documentation scope

This note and the corresponding Roadmap/Build Log entries are local delivery documentation written after the deployment. They are not part of the deployed commit and have not been committed, pushed or redeployed by this documentation task. The GitHub application source remains at the exact commit above.

## Subsequent checks — 2026-10-25

Parent cookie-free HTTPS GETs of the production alias `/` and `/login` both returned HTTP 200 with the actual catalog/account-unavailable pages. Project protection settings remain enabled, but these alias pages are publicly reachable; no share/bypass link or protection change was needed. Environment metadata reports zero configured keys and zero hidden production keys. The user subsequently authorized the hosted Supabase schema/taxonomy push, completed in [[03 Delivery/Hosted Supabase Migration Verification]]. That schema-only step does not install Vercel keys or activate hosted account/catalog services, and it does not alter the earlier observations above.
