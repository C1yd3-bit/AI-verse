# Foundation database

Apply the migration and seed to a dedicated local/development Supabase project. The app uses only the public publishable/anonymous key with user session cookies. Authenticated writes validate the server identity and database routines derive their owner from `auth.uid()`.

Preferences have one canonical array row per viewer; `save_viewer_preferences` atomically validates taxonomy and replaces both lists. Direct insert/update/delete permissions are revoked. This avoids partially completed onboarding and keeps the 5–8 constraint atomic. Skip explicitly removes all selections. Public taxonomy is read-only. Profiles expose only owner reads and owner updates to `display_name`; no role metadata is editable through a profile.

`set_user_role` is an audited admin-only routine. Moderators and users cannot grant roles. Even admins cannot change their own roles. No admin is seeded. Bootstrap the first admin manually through a trusted project owner SQL connection, after independently identifying the existing verified Auth UUID:

```sql
-- Replace the UUID only in a trusted SQL console; never expose an admin credential.
insert into public.user_roles(user_id, role)
values ('VERIFIED_EXISTING_AUTH_UUID'::uuid, 'admin');
```

Record that initial grant in your restricted operational audit. Later role changes must use the audited routine. The public app has no creator/admin management UI in this slice. Removing the last admin is an operational action requiring owner recovery; coordinate administrator changes.

Tests use PGlite's real PostgreSQL engine with an emulated `auth.users`, `auth.uid()` and Supabase roles. They exercise SQL privilege and RLS behavior, not hosted Supabase authentication, email delivery, connection settings, or provider rate limits. Before enabling accounts publicly, verify Supabase email confirmations, redirect allowlist, CAPTCHA and rate limits, production cookie/domain settings, and hosted RLS with two real sessions.
