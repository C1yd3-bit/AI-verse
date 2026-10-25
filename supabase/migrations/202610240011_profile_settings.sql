-- Owner-private account hub. Provider facts and individual viewers never appear
-- in its result. Aggregate definer privileges are needed to count engagement
-- received from other viewers; every RPC derives the verified caller itself.
create table public.account_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  theme text not null default 'dark' check(theme in ('dark','light')),
  updated_at timestamptz not null default now()
);
alter table public.account_settings enable row level security;
create policy account_settings_owner_read on public.account_settings for select to authenticated
  using(user_id=(select auth.uid()) and (select public.has_verified_email()));
revoke all on public.account_settings from public,anon,authenticated;
grant select on public.account_settings to authenticated;

create index videos_owner_profile on public.videos(owner_id,created_at desc,id desc) where state<>'removed';
create index video_signals_received_likes on public.video_signals(video_id) where signal='like';
create index watch_completions_received_credits on public.watch_completions(video_id) where credited;
create index creator_applications_owner_latest on public.creator_applications(user_id,created_at desc,id desc);

create function public.set_my_appearance(requested_theme text) returns void language plpgsql security definer set search_path='' as $$
declare viewer uuid:=auth.uid();
begin
  if viewer is null or not public.has_verified_email() then raise exception 'Verified email required' using errcode='42501'; end if;
  if requested_theme is null or requested_theme not in ('dark','light') then raise exception 'Invalid appearance' using errcode='22023'; end if;
  insert into public.account_settings(user_id,theme) values(viewer,requested_theme)
    on conflict(user_id) do update set theme=excluded.theme,updated_at=now();
end;
$$;
revoke all on function public.set_my_appearance(text) from public,anon,authenticated;
grant execute on function public.set_my_appearance(text) to authenticated;

create function public.update_my_account_information(payload jsonb) returns void language plpgsql security definer set search_path='' as $$
declare viewer uuid:=auth.uid(); full_name_value text; age_value integer; contact_value text;
begin
  if viewer is null or not public.has_verified_email() then raise exception 'Verified email required' using errcode='42501'; end if;
  if payload is null or jsonb_typeof(payload)<>'object' or octet_length(payload::text)>2048
    or not(payload ?& array['fullName','age','contactNumber']) then raise exception 'Invalid account information' using errcode='22023'; end if;
  if exists(select 1 from jsonb_object_keys(payload) k where k not in ('fullName','age','contactNumber'))
    or jsonb_typeof(payload->'fullName') is distinct from 'string'
    or jsonb_typeof(payload->'age') is distinct from 'number'
    or payload->>'age' !~ '^[0-9]{1,3}$' then raise exception 'Invalid account fields' using errcode='22023'; end if;
  full_name_value:=public.trim_media_text(payload->>'fullName'); age_value:=(payload->>'age')::integer;
  if public.media_text_length(full_name_value) not between 1 and 80 or age_value not between 1 and 120 then raise exception 'Invalid name or age' using errcode='22023'; end if;
  if payload->'contactNumber'<>'null'::jsonb then
    if jsonb_typeof(payload->'contactNumber')<>'string' then raise exception 'Invalid contact number' using errcode='22023'; end if;
    contact_value:=public.trim_media_text(payload->>'contactNumber');
    if public.media_text_length(contact_value) not between 7 and 32 or contact_value !~ '^\+?[0-9() .-]+$'
      or char_length(regexp_replace(contact_value,'[^0-9]','','g')) not between 7 and 15 then raise exception 'Invalid contact number' using errcode='22023'; end if;
  end if;
  -- Shared lock order with onboarding; never rewrite completion, consent or interests.
  perform 1 from public.profiles where id=viewer for update;
  update public.account_details set full_name=full_name_value,age=age_value,contact_number=contact_value,updated_at=now() where user_id=viewer;
  if not found then raise exception 'Complete account onboarding first' using errcode='22023'; end if;
end;
$$;
revoke all on function public.update_my_account_information(jsonb) from public,anon,authenticated;
grant execute on function public.update_my_account_information(jsonb) to authenticated;

create function public.get_my_profile() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare viewer uuid:=auth.uid(); result jsonb;
begin
  if viewer is null or not public.has_verified_email() then raise exception 'Verified email required' using errcode='42501'; end if;
  -- 'removed' is the existing terminal video state. Hidden and rejected content
  -- stays manageable. Latest-revision pending/draft counts can overlap a video's
  -- published count while its active approved revision remains public.
  with owned as materialized (
    select v.id,v.state,v.created_at,r.metadata,r.state as revision_state
    from public.videos v left join public.video_versions r on r.id=v.latest_version_id and r.video_id=v.id
    where v.owner_id=viewer and v.state<>'removed'
  ), received_likes as materialized (
    select s.video_id,count(*) as n from public.video_signals s join owned o on o.id=s.video_id where s.signal='like' group by s.video_id
  ), received_completions as materialized (
    -- Credited records are unique per viewer/video/UTC day, not unique people,
    -- lifetime views or provider analytics. Only currently retained rows count.
    select c.video_id,count(*) as n from public.watch_completions c join owned o on o.id=c.video_id where c.credited group by c.video_id
  ), recent as (
    select o.*,coalesce(l.n,0) as likes,coalesce(c.n,0) as completions from owned o
    left join received_likes l on l.video_id=o.id left join received_completions c on c.video_id=o.id
    order by o.created_at desc,o.id desc limit 20
  )
  select jsonb_build_object(
    'account',(select jsonb_build_object('fullName',a.full_name,'age',a.age,'contactNumber',a.contact_number,'completedAt',a.completed_at) from public.account_details a where a.user_id=viewer),
    'appearance',jsonb_build_object('theme',coalesce((select s.theme from public.account_settings s where s.user_id=viewer),'dark')),
    'creator',jsonb_build_object('approved',exists(select 1 from public.user_roles r where r.user_id=viewer and r.role='creator'),'suspended',public.creator_is_suspended(viewer),'applicationStatus',(select a.status from public.creator_applications a where a.user_id=viewer order by a.created_at desc,a.id desc limit 1)),
    'stats',jsonb_build_object('total',(select count(*) from owned),'published',(select count(*) from owned where state='published'),'pendingReview',(select count(*) from owned where revision_state='pending_review'),'drafts',(select count(*) from owned where revision_state='draft'),'likes',coalesce((select sum(n) from received_likes),0),'creditedCompletions',coalesce((select sum(n) from received_completions),0)),
    'content',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'title',coalesce(r.metadata->>'title','Untitled video'),'format',case when r.metadata->>'format' in ('reel','movie') then r.metadata->>'format' else null end,'state',case when r.state='hidden' then 'hidden' else coalesce(r.revision_state,r.state) end,'createdAt',r.created_at,'likes',r.likes,'creditedCompletions',r.completions) order by r.created_at desc,r.id desc) from recent r),'[]'::jsonb)
  ) into result;
  return result;
end;
$$;
revoke all on function public.get_my_profile() from public,anon,authenticated;
grant execute on function public.get_my_profile() to authenticated;
