-- Direct uploaders receive no privileged role or automatic public personal profile.
-- Retain explicitly approved legacy creator fields. Other published owners use a
-- generic label; account details, Google identity, email and avatars stay private.
create or replace view public.public_creators with (security_barrier=true) as
  with approved_profiles as (
    select distinct on (a.user_id) a.user_id as id,
      a.application->>'display_name' as display_name,
      a.application->>'handle' as handle,a.application->>'bio' as bio
    from public.creator_applications a
    where a.status='approved' and not public.creator_is_suspended(a.user_id)
      and exists(select 1 from public.user_roles r where r.user_id=a.user_id and r.role='creator')
    order by a.user_id,a.decided_at desc,a.id
  )
  select id,display_name,handle,bio from approved_profiles
  union all
  select distinct c.creator_id as id,'AIVerse creator'::text as display_name,
    ''::text as handle,''::text as bio
  from public.public_catalog c
  where not exists(select 1 from approved_profiles a where a.id=c.creator_id);

revoke all on public.public_creators from public,anon,authenticated;
grant select on public.public_creators to anon,authenticated;

-- Published content, rather than a legacy creator role, establishes a follow
-- target. Self-follow, unpublished/suspended targets and direct writes stay denied.
create or replace function public.set_creator_follow(creator_id uuid,enabled boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if enabled is null or creator_id is null or creator_id=auth.uid() then raise exception 'Invalid follow' using errcode='22023'; end if;
  if enabled then
    if public.creator_is_suspended(creator_id)
      or not exists(select 1 from public.public_catalog c where c.creator_id=set_creator_follow.creator_id)
      then raise exception 'Published creator required' using errcode='22023'; end if;
    insert into public.creator_follows(user_id,creator_id) values(auth.uid(),creator_id) on conflict do nothing;
  else
    delete from public.creator_follows f where f.user_id=auth.uid() and f.creator_id=set_creator_follow.creator_id;
  end if;
end;
$$;
revoke all on function public.set_creator_follow(uuid,boolean) from public,anon,authenticated;
grant execute on function public.set_creator_follow(uuid,boolean) to authenticated;
