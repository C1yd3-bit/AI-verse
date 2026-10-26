# Direct Upload Verification

[[Home]] · [[03 Delivery/Roadmap|Roadmap]] · [[02 Architecture/Decisions#ADR-023 — Direct uploads for verified users|Direct-upload decision]] · [[02 Architecture/Media Provider|Media provider]] · [[02 Architecture/Trust Controls|Trust controls]]

2026-10-26. The user explicitly removed the creator-application/administrator-approval prerequisite so eligible signed-in users can prepare their own videos directly. Implementation is **functionally accepted** and receives **scoped visual SHIP** for gate removal. Migrations016/017 are applied locally and hosted with data preserved. The user explicitly approved release; **Git publication and Vercel release are underway, not yet verified complete**. No real video-upload success is claimed.

## Authorized behavior

- Verified, unsuspended signed-in owners may prepare their own video drafts without an application or creator-role grant.
- Studio removes application form/status requests and the approval-gated upload interface; eligibility and account identity remain explicit, with separate signed-out/forbidden/provider-unavailable states.
- Rights/AI attestations, ownership, suspension, exact-revision human review and publication boundaries remain required.
- Reels remain capped at180seconds, Movies1200seconds, files500000000bytes, with the existing multipart/TUS threshold. Default allowances remain three uploads/day and1800seconds/month.
- Moderator/administrator powers remain separately restricted. Creator applications and existing role records are retained as history rather than deleted or automatically rewritten.

## Implemented boundaries

Migration016 introduces `can_upload_media` and verified-owner eligibility across drafts, versions, reservations, artwork and internal provider grant/bind/processing gates. Legacy `is_creator` keeps its role meaning. Suspension and quota-override operations remain administrator-only while accepting existing ordinary account targets, even before those targets meet upload-verification eligibility.

Migration017 preserves legacy approved public creator fields and supplies a generic `AIVerse creator` attribution with empty handle/bio only for ordinary owners of actual eligible published content. It never copies private account identity. Follow enablement requires actual published eligible content; hidden/suspended ordinary owners lose the public fallback.

The UI removes the application dependency, uses eligibility from the Studio API, preserves account guards and distinguishes HTTP401/403 states. Profile/public creator copy adapts without implying a privileged creator role. Confirmed signed-out/access-loss states expose recovery actions; the existing authenticated viewer does not receive a redundant Sign in link.

## Current verification and application status

Parent full checks passed **623 tests across 53 files**, global TypeScript, ESLint and formatting before the final two copy/Sign in conditional refinements. After the final Sign in fix, the affected **21 Studio client tests**, typecheck, scoped lint/format and final production build with **40/40 generated pages** passed; the full623-test suite was not rerun afterward. Independent functional verification passes **104 tests across nine files** plus a separate zero-role/hosted-default-grants probe and returns **ACCEPT**. The probe confirms verified users can draft/reserve without an application or role grant while ownership, quotas, suspension, review and service-only provider boundaries remain. Public attribution/privacy regressions are covered. These are attributed results, not tests rerun by this documentation task.

The parent applied local migrations016/017 transactionally to the dedicated local database with exact source/history and no reset. Digests for all31 public tables and Auth users remain unchanged. A real PostgreSQL rollback probe used the existing verified viewer to prepare a draft/reservation successfully, then rolled back; no extra fixture persisted and no account, role or provider write occurred.

Actual local browser inspection used the retained viewer account only. Studio shows the direct draft form, no application form and no redundant Sign in link; rights and Save controls are enabled. A preliminary accessibility snapshot misreported those booleans; direct DOM inspection confirmed both are enabled. Requested desktop viewport1440 has client/scroll widths1430/1430; phone viewport390 has380/380, with no horizontal overflow. Three private desktop/phone/bottom captures are valid. No browser form was submitted. Independent finish re-scored the persistence FIX as resolved and records **SHIP for the scoped gate-removal change only**. The current Studio brief and DESIGN narrative were updated; visual primitives/sidecar remain unchanged. Prior formal method gates remain open.

After explicit user release approval, the parent applied hosted016/017 in original order through the CLI. A second remote dry run reports up to date. Before/after digests match for all31 public tables plus Auth users: **32 scopes preserved**. The pre-push baseline already contained one real Auth user and four business rows created by the user since the earlier Google setup proof; those records were retained, not agent-created. No account or role was created by this migration push.

Independent hosted postflight returns **ACCEPT for the migration scope**:17 migration versions,31 RLS tables,59 functions, pinned definer search paths, unchanged public projection columns and service-only provider hooks. A read-only capability probe of the existing verified ordinary account returns `can_upload_media=true` while creator/admin/moderator checks are false. Observed counts are Auth1, viewer-role1, applications0, videos0 and catalog0; no business RPC write or login was performed by the verifier. The32 preservation scopes match exactly.

Git source publication and Vercel release are underway, with final commit/tree/deployment verification still pending at this documentation freeze. Earlier delivery notes remain historical evidence for their original contracts and are not retroactively invalidated.

## Hosted advisor evidence after application

The installed hosted inventory has59 application functions. Fresh detailed advisor verification reports **50 returned instances across five categories, all OPEN**, including43 definer instances. The expected new authenticated `can_upload_media` helper increases the definer baseline from42 to43; six policyless-table INFO instances and one leaked-password WARN are additional categories outside that old definer-only baseline.

| Advisor category                          | Level | Open instances | Reference                                                                                                                                                 |
| ----------------------------------------- | ----- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RLS enabled without policy                | INFO  | 6              | [Policyless-table guidance](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)                                    |
| Security-definer view                     | ERROR | 2              | [View guidance](https://supabase.com/docs/guides/database/database-linter?lint=0010_security_definer_view)                                                |
| Anonymous-executable definer function     | WARN  | 4              | [Anonymous-function guidance](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable)              |
| Authenticated-executable definer function | WARN  | 37             | [Authenticated-function guidance](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) |
| Leaked-password protection disabled       | WARN  | 1              | [Password-protection guidance](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)                  |

The six policyless tables are internal service/sealed tables with external raw access denied. Public definer views retain allowlists and eligibility filters; guarded RPCs retain their intended owner/role boundaries. These dispositions do not close the findings. Five categories do not mean five findings or resolution of the earlier42. No clean-security conclusion, alert suppression or unrelated remediation is claimed.

## Provider and release limits

The user previously declined Cloudflare Stream configuration, which remains authoritative. Stream is disabled; removing an application prerequisite does not activate credentials, billing, binary transfer, processing or playback. Current local configuration supports draft preparation, with actual binary transfer unavailable. No supplied film was uploaded or published.

SMTP still requires a new Google App Password. Earlier Google setup evidence stopped before user sign-in; the subsequent user-created Auth account does not establish this slice's email delivery or cross-user/session acceptance. The earlier42-object definer report is a historical baseline; the current50 returned instances across five categories remain open as recorded above. Human content review and full provider/security/release acceptance remain separate.

This task writes local documentation only, with no SQL, source, environment, account, service, Git commit or deployment change.
