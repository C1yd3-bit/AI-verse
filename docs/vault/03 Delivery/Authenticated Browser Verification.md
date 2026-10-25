# Authenticated local browser verification

2026-10-24. The user explicitly approved a disposable administrator/creator account in the isolated local test database, followed by cleanup. That approval resolved the earlier automatic approval rejection; no privileged browser persona existed before approval. The approved fixture used two synthetic accounts so application and video decisions came from a different owner.

## Environment and limits

The actual application at `http://127.0.0.1:3000/` used dedicated local Supabase project `aiverse-ana` at loopback port 55321. Browser actions used the in-app browser through CUA. Existing generated credentials stayed in a temporary private file and were never printed. Hosted services, production accounts and unrelated local projects were untouched.

There was no binary video, Cloudflare request or publication. For the review screen only, exact disposable revision IDs passed through the real local reservation, lease, bind and reconcile RPCs with explicitly simulated 90-second provider facts. This proves local state transitions and unavailable-player handling, not real processing or playback.

## Verified interactions

- Candidate signed in, submitted a synthetic creator application and saw Pending. A separate administrator approved it; the candidate's next session exposed the creator form.
- A Korean/Romance/Reels Fusion was saved to the account Library. Its Open action restored `/fusion?region=korean&genre=romance&format=reel`; deletion showed the named removal confirmation and empty saved-mix state.
- Creator saved revision 1 privately; it survived a reload. File selection and upload were disabled, with the explanation that uploads are not enabled.
- Administrator saw the exact pending revision's metadata, duration, languages, disclosure and rights statement. Open private preview returned `Playback is not configured`. The administrator rejected that synthetic revision; it left the pending queue without publication.
- Administrator Operations loaded actual local summaries and successfully recorded the default-quota action. Suspending the candidate produced a Library incident and appeal form. The candidate submitted an appeal; administrator approval lifted only that incident. The candidate's Library showed Suspension lifted, approved appeal and administrator reason.
- Restored creator saved revision 2 for the same film. The previous title and rejected revision 1 remained visible separately. The replacement's local simulated pending state was captured for review.
- Administrator signed out before fixture cleanup. The final browser returned to guest state.

Admin exercised the shared film-review controls. A distinct moderator-only browser persona was not created. Moderator denial of role grants and other permission differences are covered by the separate real local integration and SQL tests in [[03 Delivery/Verification]].

## Capture evidence

Fourteen full-document screenshots are stored in `.impeccable/review/auth/`: `application-pending`, `library-signed-in`, `moderation-application`, `operations-admin`, `studio-creator`, `moderation-film`, and `library-appeal`, each with `-desktop.png` and `-mobile.png` variants. Desktop viewport was 1440 × 1000 and mobile 390 × 844. Observed document widths did not exceed the mobile viewport. The Library appeal captures show the resolved incident.

The parent opened every file. Initial Studio/review captures with scrolled fixed-position artifacts were replaced after returning to document top; the current files show settled controls and complete page bottoms. Search focus in the replacement captures is intentional. No new detector or visual redesign was run. Independent appearance disposition is in [[03 Delivery/MVP Design Review]]. This bounded pass is not a comprehensive accessibility or real-player audit.

## Cleanup

After browser logout, a guarded local helper removed records only for the two exact fixture account UUIDs. It removed their applications, role/media audit, revisions, reservations, simulated assets/events/deletion jobs, quota and suspension/appeal records before deleting the Auth users. Auth lookup confirmed both absent; owner-scoped video and role queries were empty. The temporary credential file was removed. No Cloudflare deletion was attempted because no real provider asset existed.

No product source changed during this walkthrough. The preceding passing typecheck, lint, formatting, 128 tests in 15 files, 32-page production build and both local integrations remain the automated baseline. All 26 HTTP smoke checks passed again after cleanup; the ordinary sandbox's loopback EACCES was resolved by the already authorized elevated check. The independent verifier also confirmed zero isolated fixture records and absence of the credential file. Real hosted identity, licensed upload/playback, revocation/deletion timing, cost/restore drills, operational policy and human artwork acceptance remain open in [[03 Delivery/Release Checklist]].
