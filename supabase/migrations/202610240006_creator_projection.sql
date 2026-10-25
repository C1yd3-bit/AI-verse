-- Approved application profile fields only. Email, portfolio, rights and notes stay private.
create view public.public_creators with (security_barrier=true) as
  select distinct on (a.user_id) a.user_id as id,a.application->>'display_name' as display_name,
    a.application->>'handle' as handle,a.application->>'bio' as bio
  from public.creator_applications a
  where a.status='approved' and not public.creator_is_suspended(a.user_id)
    and exists(select 1 from public.user_roles r where r.user_id=a.user_id and r.role='creator')
  order by a.user_id,a.decided_at desc,a.id;
revoke all on public.public_creators from public,anon,authenticated;
grant select on public.public_creators to anon,authenticated;
