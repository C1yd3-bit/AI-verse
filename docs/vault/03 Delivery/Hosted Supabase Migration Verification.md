# Hosted Supabase Migration Verification

[[Home]] · [[03 Delivery/Roadmap|Roadmap]] · [[03 Delivery/Build Log|Build log]] · [[04 Operations/Hosted Environment|Hosted environment]] · [[04 Operations/Local Development|Local development]]

2026-10-25. The user explicitly requested pushing migrations to the existing hosted **AI Verse** Supabase project. This supersedes the earlier hosted-DDL deferral for the reviewed schema and canonical taxonomy only. The migration push completed successfully; independent read-only schema/taxonomy postflight returned **ACCEPT**. Security advisors still report 42 findings, detailed below. Hosted application activation remains separate.

## Target, preflight and application

The parent verified the intended project through the authenticated CLI and linked it using ignored temporary metadata. The hosted preflight found PostgreSQL 17.11, no application public tables/views/routines, no migration history and zero Auth users. All 15 existing migration files and the taxonomy seed matched reviewed GitHub source commit `91101b3d59ceca17c444d4fe498e65e8f8278bfc`; independent preflight accepted that exact pending set.

Using the installed CLI 2.78, the parent ran:

```powershell
supabase db push --linked --dry-run --include-seed
supabase db push --linked --include-seed --yes
```

The actual push exited successfully after applying all 15 migrations in their original order/versions and the taxonomy-only seed. The installed migration list matched all original versions; a second dry run reported the remote database up to date. No SQL source was rewritten, history repaired, database reset, mock film inserted or account created.

Native MCP OAuth renewal completed, but the current chat's MCP tools still requested authentication. The authenticated CLI fallback performed the authorized push. A pinned `npx` CLI 2.122 was subsequently used for read-only queries/advisors; the installed CLI was not upgraded.

## Independent hosted postflight

The independent verifier inspected actual hosted metadata and pure SELECT results, without invoking business RPCs, creating fixtures or disclosing private rows. Its ACCEPT is scoped to the installed schema and taxonomy, rather than a complete hosted application/security acceptance.

| Check                      | Actual hosted result                                                                                                                            |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Migration history          | All 15 original versions match                                                                                                                  |
| Application tables and RLS | 31 tables; RLS enabled on all; 26 policies                                                                                                      |
| Application functions      | 58 exact functions; SECURITY DEFINER search paths pinned                                                                                        |
| Public projections         | Two security-barrier views with allowlisted columns                                                                                             |
| Auth initialization        | Viewer-initialization trigger enabled; Auth users remain zero and the empty identifier digest is retained                                       |
| Business data              | All 28 non-taxonomy application tables empty; public catalog and creator projections empty                                                      |
| Taxonomy                   | 12 genres, 12 content regions, 17 languages                                                                                                     |
| Raw access                 | No unexpected anonymous/authenticated raw writes; no authenticated raw reads of private tables; profile update column limited to `display_name` |
| Provider boundaries        | 13 privileged provider/session RPCs service-only; sealed artwork raw service access denied                                                      |
| Full-film limits           | 1200-second constraint cap; Reels 180 seconds, Movies 1200 seconds; default three daily uploads and 1800 monthly seconds                        |

This metadata evidence does not substitute for hosted signup, role/owner workflows, real media processing or playback. Existing local development data, configuration and active environment were retained; this push made no writes to the local database. No new local account-hash baseline was taken or inferred.

## Security advisor findings remain visible

The actual security-advisor report contains **42 findings: two ERROR and 40 WARN**. These findings have not been silenced or resolved by this migration task.

| Advisor                                            | Count and reported level | Scope and remediation reference                                                                                                                                                                                                             |
| -------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Security definer view                              | 2 ERROR                  | `public_catalog` and `public_creators`; [Supabase view advisor guidance](https://supabase.com/docs/guides/database/database-linter?lint=0010_security_definer_view)                                                                         |
| Anonymous-executable SECURITY DEFINER function     | 4 WARN                   | `creator_is_suspended`, `discover_catalog`, `get_public_version_artwork`, `is_admin`; [Supabase anonymous-function guidance](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable) |
| Authenticated-executable SECURITY DEFINER function | 36 WARN                  | Signed-in application RPC surface; [Supabase authenticated-function guidance](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)                                       |

Independent advisor classification returns **ACCEPT for the migration scope with all 42 findings explicitly OPEN**. The two owner-rights public views are intentional projection boundaries over private RLS tables: their actual definitions use column allowlists, published/active/non-suspended eligibility filters and security barriers. The advisor ERROR levels remain recorded; no view rewrite was required for this migration push.

The four anonymous-executable functions expose read-only public catalog/artwork, a suspension boolean for a supplied identifier and a caller-derived `is_admin` boolean. The review found no unexpected anonymous mutating RPC. The hosted default anonymous `is_admin` grant is unnecessary surface for later least-privilege hardening; the limited suspension-status disclosure remains an explicit privacy decision. Neither warning is silently accepted as a universal safe default.

The 36 authenticated-executable functions follow existing RPC contracts whose reviewed SQL derives `auth.uid()` and applies relevant verified-email, ownership, administrator, moderator or issued-playback-session checks. Actual provider/session mutating primitives remain service-only. This source/metadata classification identified no correction required for the schema push and no new data leak; it is not a full security audit. No advisor alert was resolved or suppressed, and hosted Auth/JWT/cross-user functional tests and full security/release acceptance remain pending.

## Runtime and delivery boundary

No Auth/provider settings, application roles, Vercel keys/environment variables, Cloudflare configuration or billing were changed. The staged hosted environment profile remains ignored and inactive; local `.env.local` remains the development configuration. Vercel still has no configured hosted service environment, so schema availability alone does not connect the deployed app to Supabase. Stream stays disabled and no actual film was uploaded or published.

The earlier Vercel verification recorded cookie-free HTTPS GETs of the production alias `/` and `/login` returning HTTP 200 with actual AIVerse unavailable states; those were hosting-slice observations rather than hosted account tests. A fresh read-only Vercel environment-metadata check after this migration still reports zero configured variables and zero hidden production variables. No hosting protection setting was changed or bypass/share link created. Public access to the alias pages must not be confused with functional hosted account services.

This record and the accompanying Operations/Roadmap/Build Log edits are local documentation. They do not change GitHub source, SQL, the deployed commit or hosting configuration, and this documentation task performs no commit, push, deploy or service mutation. Scoped Markdown formatting/diff checks are recorded by the documentation handoff; no application test suite rerun is claimed.
