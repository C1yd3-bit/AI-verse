-- Local MVP defaults are proposals; operator policy approval precedes live use.
create table public.saved_fusions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check(char_length(name) between 1 and 80),
  query jsonb not null check(octet_length(query::text)<=8192),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.video_signals (
  user_id uuid not null references auth.users(id) on delete cascade,
  video_id uuid not null references public.videos(id),
  signal text not null check(signal in ('like','not_interested')),
  created_at timestamptz not null default now(),
  primary key(user_id,video_id,signal)
);
create table public.creator_follows (
  user_id uuid not null references auth.users(id) on delete cascade,
  creator_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  primary key(user_id,creator_id),
  check(user_id<>creator_id)
);
create table public.watch_completions (
  user_id uuid not null references auth.users(id) on delete cascade,
  session_key uuid not null,
  video_id uuid not null references public.videos(id),
  version_id uuid not null references public.video_versions(id),
  watched_seconds integer not null check(watched_seconds between 1 and 180),
  duration_seconds integer not null check(duration_seconds between 1 and 180),
  user_initiated boolean not null check(user_initiated),
  credited boolean not null,
  recorded_day date not null default ((now() at time zone 'UTC')::date),
  created_at timestamptz not null default now(),
  primary key(user_id,session_key),
  check(watched_seconds<=duration_seconds)
);
create unique index one_completion_credit_daily on public.watch_completions(user_id,video_id,recorded_day) where credited;
create index watch_completions_retention on public.watch_completions(created_at);
create table public.video_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users(id),
  video_id uuid not null references public.videos(id),
  version_id uuid not null references public.video_versions(id),
  category text not null check(category in ('rights','harmful','misleading','other')),
  details text not null check(char_length(details) between 5 and 2000),
  status text not null default 'pending' check(status in ('pending','dismissed','hidden','removed')),
  resolution_reason text,
  resolved_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index video_reports_limit on public.video_reports(reporter_id,created_at);
create table public.creator_suspensions (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references auth.users(id),
  active boolean not null default true,
  reason text not null check(char_length(reason) between 5 and 1000),
  decided_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  lifted_at timestamptz
);
create unique index one_active_suspension on public.creator_suspensions(creator_id) where active;
create table public.creator_appeals (
  id uuid primary key default gen_random_uuid(),
  suspension_id uuid not null references public.creator_suspensions(id),
  creator_id uuid not null references auth.users(id),
  statement text not null check(char_length(statement) between 10 and 4000),
  status text not null default 'pending' check(status in ('pending','approved','rejected')),
  decision_reason text,
  decided_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create unique index one_pending_suspension_appeal on public.creator_appeals(suspension_id) where status='pending';
create table public.quota_overrides (
  creator_id uuid primary key references auth.users(id),
  daily_uploads integer not null check(daily_uploads between 1 and 100),
  monthly_seconds integer not null check(monthly_seconds between 180 and 86400),
  expires_at timestamptz not null,
  reason text not null check(char_length(reason) between 5 and 1000),
  decided_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now()
);

alter table public.saved_fusions enable row level security;
alter table public.video_signals enable row level security;
alter table public.creator_follows enable row level security;
alter table public.watch_completions enable row level security;
alter table public.video_reports enable row level security;
alter table public.creator_suspensions enable row level security;
alter table public.creator_appeals enable row level security;
alter table public.quota_overrides enable row level security;
create policy saved_fusions_owner on public.saved_fusions for select to authenticated using(owner_id=auth.uid());
create policy video_signals_owner on public.video_signals for select to authenticated using(user_id=auth.uid());
create policy creator_follows_owner on public.creator_follows for select to authenticated using(user_id=auth.uid());
create policy watch_completions_owner on public.watch_completions for select to authenticated using(user_id=auth.uid());
create policy video_reports_read on public.video_reports for select to authenticated using(reporter_id=auth.uid() or public.can_review_media());
create policy creator_suspensions_read on public.creator_suspensions for select to authenticated using(creator_id=auth.uid() or public.is_admin());
create policy creator_appeals_read on public.creator_appeals for select to authenticated using(creator_id=auth.uid() or public.is_admin());
create policy quota_overrides_read on public.quota_overrides for select to authenticated using(creator_id=auth.uid() or public.is_admin());
revoke all on public.saved_fusions,public.video_signals,public.creator_follows,public.watch_completions,public.video_reports,public.creator_suspensions,public.creator_appeals,public.quota_overrides from public,anon,authenticated;
grant select on public.saved_fusions,public.video_signals,public.creator_follows,public.watch_completions,public.video_reports,public.creator_suspensions,public.creator_appeals,public.quota_overrides to authenticated;

-- Boolean only, intentionally available to public_catalog callers. No private
-- reason, incident ID or arbitrary profile data crosses this helper boundary.
create or replace function public.creator_is_suspended(target uuid) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.creator_suspensions where creator_id=target and active);
$$;
create or replace function public.get_upload_limits(target uuid) returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('daily_uploads',coalesce(o.daily_uploads,3),'monthly_seconds',coalesce(o.monthly_seconds,1800),'max_duration_seconds',180)
    from (select 1) base left join public.quota_overrides o on o.creator_id=target and o.expires_at>now();
$$;
revoke all on function public.creator_is_suspended(uuid),public.get_upload_limits(uuid) from public,anon,authenticated;
grant execute on function public.creator_is_suspended(uuid) to anon,authenticated;
grant execute on function public.get_upload_limits(uuid) to service_role;

create function public.canonical_discovery_query(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare dimension text; selections text[]; result jsonb:='{}'; maximum integer; normalized text; minimum_duration integer; maximum_duration integer;
begin
  if input is null or jsonb_typeof(input)<>'object' or octet_length(input::text)>8192
    or exists(select 1 from jsonb_object_keys(input) k where k not in ('keywords','regions','genres','formats','languages','hashtags','minDurationSeconds','maxDurationSeconds'))
    then raise exception 'Invalid discovery query' using errcode='22023'; end if;
  foreach dimension in array array['keywords','regions','genres','formats','languages','hashtags'] loop
    if input ? dimension and jsonb_typeof(input->dimension)<>'array' then raise exception 'Invalid discovery selection' using errcode='22023'; end if;
    if exists(select 1 from jsonb_array_elements(coalesce(input->dimension,'[]'::jsonb)) s where jsonb_typeof(s)<>'string') then raise exception 'Expected discovery strings' using errcode='22023'; end if;
    maximum:=case dimension when 'keywords' then 32 when 'formats' then 2 when 'languages' then 17 when 'hashtags' then 10 else 12 end;
    if jsonb_array_length(coalesce(input->dimension,'[]'::jsonb))>maximum then raise exception 'Too many discovery selections' using errcode='22023'; end if;
    select coalesce(array_agg(distinct lower(normalize(s,NFKC)) order by lower(normalize(s,NFKC))),'{}'::text[]) into selections from jsonb_array_elements_text(coalesce(input->dimension,'[]'::jsonb)) s;
    if exists(select 1 from unnest(selections) s where char_length(s) not between 1 and 80 or s !~ '^[[:alnum:]][[:alnum:]''_-]*$') then raise exception 'Invalid discovery token' using errcode='22023'; end if;
    if dimension='regions' then
      if exists(select 1 from unnest(selections) s where not exists(select 1 from public.content_regions r where r.slug=s)) then raise exception 'Unknown discovery region' using errcode='22023'; end if;
      if 'global'=any(selections) then selections:='{}'::text[]; end if;
    elsif dimension='genres' and exists(select 1 from unnest(selections) s where not exists(select 1 from public.genres g where g.slug=s)) then raise exception 'Unknown discovery genre' using errcode='22023';
    elsif dimension='formats' and not selections<@array['reel','movie'] then raise exception 'Unknown discovery format' using errcode='22023';
    elsif dimension='languages' and not selections<@array['english','korean','mandarin','cantonese','tagalog','japanese','hindi','thai','vietnamese','turkish','spanish','french','german','portuguese','arabic','indonesian','silent'] then raise exception 'Unknown discovery language' using errcode='22023';
    end if;
    result:=result||jsonb_build_object(dimension,to_jsonb(selections));
  end loop;
  foreach dimension in array array['minDurationSeconds','maxDurationSeconds'] loop
    if input ? dimension then
      if jsonb_typeof(input->dimension)<>'number' or (input->>dimension) !~ '^[0-9]{1,5}$' or (input->>dimension)::integer>10800 then raise exception 'Invalid discovery duration' using errcode='22023'; end if;
      result:=result||jsonb_build_object(dimension,(input->>dimension)::integer);
    end if;
  end loop;
  minimum_duration:=(result->>'minDurationSeconds')::integer; maximum_duration:=(result->>'maxDurationSeconds')::integer;
  if minimum_duration>maximum_duration then raise exception 'Invalid duration range' using errcode='22023'; end if;
  return result;
end;
$$;
create function public.save_fusion(filter_id uuid,name text,query jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare canonical jsonb; result_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if name is null or char_length(trim(name)) not between 1 and 80 then raise exception 'Invalid saved filter name' using errcode='22023'; end if;
  canonical:=public.canonical_discovery_query(query);
  perform 1 from public.profiles where id=auth.uid() for update;
  if filter_id is null then
    if (select count(*) from public.saved_fusions where owner_id=auth.uid())>=20 then raise exception 'Saved filter limit reached' using errcode='22023'; end if;
    insert into public.saved_fusions(owner_id,name,query) values(auth.uid(),trim(name),canonical) returning id into result_id;
  else
    update public.saved_fusions f set name=trim(save_fusion.name),query=canonical,updated_at=now() where f.id=filter_id and f.owner_id=auth.uid() returning id into result_id;
    if not found then raise exception 'Own saved filter required' using errcode='42501'; end if;
  end if;
  return result_id;
end;
$$;
create function public.delete_saved_fusion(filter_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  delete from public.saved_fusions where id=filter_id and owner_id=auth.uid();
  if not found then raise exception 'Own saved filter required' using errcode='42501'; end if;
end;
$$;
create function public.set_video_signal(video_id uuid,signal text,enabled boolean) returns void language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if signal is null or signal not in ('like','not_interested') or enabled is null then raise exception 'Invalid signal' using errcode='22023'; end if;
  if enabled then
    if not exists(select 1 from public.public_catalog c where c.id=video_id) then raise exception 'Published video required' using errcode='22023'; end if;
    insert into public.video_signals(user_id,video_id,signal) values(auth.uid(),video_id,signal) on conflict do nothing;
  else delete from public.video_signals s where s.user_id=auth.uid() and s.video_id=set_video_signal.video_id and s.signal=set_video_signal.signal;
  end if;
end;
$$;
create function public.set_creator_follow(creator_id uuid,enabled boolean) returns void language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if enabled is null or creator_id is null or creator_id=auth.uid() then raise exception 'Invalid follow' using errcode='22023'; end if;
  if enabled then
    if public.creator_is_suspended(creator_id) or not exists(select 1 from public.user_roles r where r.user_id=creator_id and r.role='creator')
      or not exists(select 1 from public.public_catalog c where c.creator_id=set_creator_follow.creator_id) then raise exception 'Published creator required' using errcode='22023'; end if;
    insert into public.creator_follows(user_id,creator_id) values(auth.uid(),creator_id) on conflict do nothing;
  else delete from public.creator_follows f where f.user_id=auth.uid() and f.creator_id=set_creator_follow.creator_id;
  end if;
end;
$$;
create function public.record_watch_completion(video_id uuid,session_key uuid,watched_seconds integer,user_initiated boolean) returns void language plpgsql security definer set search_path='' as $$
declare current_video public.public_catalog; previous public.watch_completions; credit boolean;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if user_initiated is distinct from true or session_key is null or watched_seconds is null or watched_seconds<1 then raise exception 'Explicit playback required' using errcode='22023'; end if;
  perform 1 from public.profiles where id=auth.uid() for update;
  select * into previous from public.watch_completions w where w.user_id=auth.uid() and w.session_key=record_watch_completion.session_key;
  if found then
    if previous.video_id<>video_id then raise exception 'Session key belongs to another video' using errcode='22023'; end if;
    return;
  end if;
  select * into current_video from public.public_catalog c where c.id=video_id;
  if not found then raise exception 'Published video required' using errcode='22023'; end if;
  if watched_seconds>current_video.duration_seconds or watched_seconds>180 then raise exception 'Invalid watch duration' using errcode='22023'; end if;
  if (select count(*) from public.watch_completions w where w.user_id=auth.uid() and w.created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC')>=30 then raise exception 'Watch event limit reached' using errcode='22023'; end if;
  credit:=watched_seconds*100>=current_video.duration_seconds*90 and not exists(select 1 from public.watch_completions w where w.user_id=auth.uid() and w.video_id=record_watch_completion.video_id and w.recorded_day=(now() at time zone 'UTC')::date and w.credited);
  insert into public.watch_completions(user_id,session_key,video_id,version_id,watched_seconds,duration_seconds,user_initiated,credited)
    values(auth.uid(),session_key,video_id,current_video.version_id,watched_seconds,current_video.duration_seconds,true,credit);
end;
$$;
create function public.submit_video_report(video_id uuid,category text,details text) returns uuid language plpgsql security definer set search_path='' as $$
declare current_video public.public_catalog; report_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if category is null or category not in ('rights','harmful','misleading','other') or details is null or char_length(trim(details)) not between 5 and 2000 then raise exception 'Invalid report' using errcode='22023'; end if;
  perform 1 from public.profiles where id=auth.uid() for update;
  if (select count(*) from public.video_reports r where r.reporter_id=auth.uid() and r.created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC')>=5 then raise exception 'Daily report limit reached' using errcode='22023'; end if;
  select * into current_video from public.public_catalog c where c.id=video_id;
  if not found then raise exception 'Published video required' using errcode='22023'; end if;
  insert into public.video_reports(reporter_id,video_id,version_id,category,details) values(auth.uid(),video_id,current_video.version_id,category,trim(details)) returning id into report_id;
  return report_id;
end;
$$;
create function public.resolve_video_report(report_id uuid,resolution text,reason text) returns void language plpgsql security definer set search_path='' as $$
declare report public.video_reports;
begin
  if not public.can_review_media() then raise exception 'Moderator required' using errcode='42501'; end if;
  if resolution is null or resolution not in ('dismiss','hide','remove') or reason is null or char_length(reason) not between 5 and 1000 then raise exception 'Invalid report decision' using errcode='22023'; end if;
  select * into report from public.video_reports r where r.id=report_id for update;
  if not found or report.status<>'pending' then raise exception 'Pending report required' using errcode='22023'; end if;
  if report.reporter_id=auth.uid() then raise exception 'Self report resolution denied' using errcode='42501'; end if;
  if resolution<>'dismiss' then perform public.moderate_video(report.video_id,resolution,reason); end if;
  update public.video_reports set status=case resolution when 'dismiss' then 'dismissed' when 'hide' then 'hidden' else 'removed' end,resolution_reason=reason,resolved_by=auth.uid(),resolved_at=now() where id=report_id;
  insert into public.media_audit(actor_id,action,subject_id,reason) values(auth.uid(),'report_'||resolution,report_id,reason);
end;
$$;
create function public.set_creator_suspension(creator_id uuid,suspended boolean,reason text) returns void language plpgsql security definer set search_path='' as $$
declare incident_id uuid;
begin
  if not public.is_admin() then raise exception 'Administrator required' using errcode='42501'; end if;
  if creator_id is null or creator_id=auth.uid() then raise exception 'Other creator required' using errcode='42501'; end if;
  if suspended is null or reason is null or char_length(reason) not between 5 and 1000 then raise exception 'Invalid suspension decision' using errcode='22023'; end if;
  perform 1 from public.profiles where id=creator_id for update;
  if not exists(select 1 from public.user_roles r where r.user_id=creator_id and r.role='creator') then raise exception 'Creator required' using errcode='22023'; end if;
  select id into incident_id from public.creator_suspensions s where s.creator_id=set_creator_suspension.creator_id and s.active for update;
  if suspended then
    if incident_id is not null then return; end if;
    insert into public.creator_suspensions(creator_id,reason,decided_by) values(creator_id,reason,auth.uid()) returning id into incident_id;
  else
    if incident_id is null then return; end if;
    update public.creator_suspensions set active=false,lifted_at=now() where id=incident_id;
  end if;
  insert into public.media_audit(actor_id,action,subject_id,reason) values(auth.uid(),case when suspended then 'creator_suspended' else 'creator_reinstated' end,incident_id,reason);
end;
$$;
create function public.submit_appeal(suspension_id uuid,statement text) returns uuid language plpgsql security definer set search_path='' as $$
declare appeal_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if statement is null or char_length(trim(statement)) not between 10 and 4000 then raise exception 'Invalid appeal' using errcode='22023'; end if;
  perform 1 from public.profiles where id=auth.uid() for update;
  if not exists(select 1 from public.creator_suspensions s where s.id=suspension_id and s.creator_id=auth.uid() and s.active) then raise exception 'Own active suspension required' using errcode='42501'; end if;
  if (select count(*) from public.creator_appeals a where a.creator_id=auth.uid() and a.created_at>now()-interval '30 days')>=3 then raise exception 'Appeal limit reached' using errcode='22023'; end if;
  insert into public.creator_appeals(suspension_id,creator_id,statement) values(suspension_id,auth.uid(),trim(statement)) returning id into appeal_id;
  return appeal_id;
end;
$$;
create function public.resolve_appeal(appeal_id uuid,approved boolean,reason text) returns void language plpgsql security definer set search_path='' as $$
declare appeal public.creator_appeals; creator uuid;
begin
  if not public.is_admin() then raise exception 'Administrator required' using errcode='42501'; end if;
  if approved is null or reason is null or char_length(reason) not between 5 and 1000 then raise exception 'Invalid appeal decision' using errcode='22023'; end if;
  select creator_id into creator from public.creator_appeals where id=appeal_id;
  if creator is null or creator=auth.uid() then raise exception 'Other creator appeal required' using errcode='42501'; end if;
  perform 1 from public.profiles where id=creator for update;
  select * into appeal from public.creator_appeals where id=appeal_id for update;
  if appeal.status<>'pending' then raise exception 'Pending appeal required' using errcode='22023'; end if;
  if approved then
    update public.creator_suspensions set active=false,lifted_at=now() where id=appeal.suspension_id and active;
    if not found then raise exception 'Appeal suspension is no longer active' using errcode='22023'; end if;
  end if;
  update public.creator_appeals set status=case when approved then 'approved' else 'rejected' end,decision_reason=reason,decided_by=auth.uid(),decided_at=now() where id=appeal_id;
  insert into public.media_audit(actor_id,action,subject_id,reason) values(auth.uid(),case when approved then 'appeal_approved' else 'appeal_rejected' end,appeal_id,reason);
end;
$$;
create function public.set_quota_override(creator_id uuid,daily_uploads integer,monthly_seconds integer,expires_at timestamptz,reason text) returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.is_admin() then raise exception 'Administrator required' using errcode='42501'; end if;
  if creator_id is null or creator_id=auth.uid() then raise exception 'Other creator required' using errcode='42501'; end if;
  if reason is null or char_length(reason) not between 5 and 1000 then raise exception 'Override reason required' using errcode='22023'; end if;
  perform 1 from public.profiles where id=creator_id for update;
  if not exists(select 1 from public.user_roles r where r.user_id=creator_id and r.role='creator') then raise exception 'Creator required' using errcode='22023'; end if;
  if daily_uploads is null and monthly_seconds is null and expires_at is null then
    delete from public.quota_overrides where quota_overrides.creator_id=set_quota_override.creator_id;
  else
    if daily_uploads is null or daily_uploads not between 1 and 100 or monthly_seconds is null or monthly_seconds not between 180 and 86400
      or expires_at is null or expires_at<=now() or expires_at>now()+interval '90 days' then raise exception 'Invalid quota override' using errcode='22023'; end if;
    insert into public.quota_overrides(creator_id,daily_uploads,monthly_seconds,expires_at,reason,decided_by)
      values(creator_id,daily_uploads,monthly_seconds,expires_at,reason,auth.uid())
      on conflict on constraint quota_overrides_pkey do update set daily_uploads=excluded.daily_uploads,monthly_seconds=excluded.monthly_seconds,expires_at=excluded.expires_at,reason=excluded.reason,decided_by=excluded.decided_by,updated_at=now();
  end if;
  insert into public.media_audit(actor_id,action,subject_id,reason) values(auth.uid(),'quota_override',creator_id,reason);
end;
$$;
create function public.ops_summary() returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if not public.is_admin() then raise exception 'Administrator required' using errcode='42501'; end if;
  return jsonb_build_object(
    'published_videos',(select count(*) from public.public_catalog),
    'pending_reports',(select count(*) from public.video_reports where status='pending'),
    'active_suspensions',(select count(*) from public.creator_suspensions where active),
    'pending_appeals',(select count(*) from public.creator_appeals where status='pending'),
    'pending_deletions',(select count(*) from public.media_deletion_jobs where state in ('pending','processing','retry','exhausted')),
    'processing_assets',(select count(*) from public.private_media_assets where state='processing'),
    'failed_assets',(select count(*) from public.private_media_assets where state='failed'),
    'stored_seconds',(select coalesce(sum(r.consumed_seconds),0) from public.private_media_assets a join public.upload_reservations r on r.id=a.reservation_id where a.state<>'deleted'),
    'claimed_watch_seconds_utc_day',(select coalesce(sum(watched_seconds),0) from public.watch_completions where created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'),
    'credited_completions_utc_day',(select count(*) from public.watch_completions where credited and recorded_day=(now() at time zone 'UTC')::date)
  );
end;
$$;
-- Trusted worker must receive an operator-approved retention cutoff. No schedule
-- or policy approval is implied by this callable, bounded cleanup operation.
create function public.purge_operational_events(cutoff timestamptz) returns jsonb language plpgsql security definer set search_path='' as $$
declare watch_deleted integer; events_deleted integer;
begin
  if cutoff is null or cutoff>now()-interval '1 day' or cutoff<now()-interval '365 days' then raise exception 'Retention cutoff must retain 1 to 365 days' using errcode='22023'; end if;
  with obsolete as (select user_id,session_key from public.watch_completions where created_at<cutoff order by created_at limit 1000 for update skip locked)
    delete from public.watch_completions w using obsolete o where w.user_id=o.user_id and w.session_key=o.session_key;
  get diagnostics watch_deleted=row_count;
  with obsolete as (select e.event_key from public.provider_events e where e.created_at<cutoff and exists(select 1 from public.private_media_assets a where a.provider_uid=e.provider_uid and a.state='deleted') order by e.created_at limit 1000 for update skip locked)
    delete from public.provider_events e using obsolete o where e.event_key=o.event_key;
  get diagnostics events_deleted=row_count;
  return jsonb_build_object('watch_events',watch_deleted,'terminal_provider_events',events_deleted);
end;
$$;

revoke all on function public.canonical_discovery_query(jsonb),public.save_fusion(uuid,text,jsonb),public.delete_saved_fusion(uuid),public.set_video_signal(uuid,text,boolean),public.set_creator_follow(uuid,boolean),public.record_watch_completion(uuid,uuid,integer,boolean),public.submit_video_report(uuid,text,text),public.resolve_video_report(uuid,text,text),public.set_creator_suspension(uuid,boolean,text),public.submit_appeal(uuid,text),public.resolve_appeal(uuid,boolean,text),public.set_quota_override(uuid,integer,integer,timestamptz,text),public.ops_summary(),public.purge_operational_events(timestamptz) from public,anon,authenticated;
grant execute on function public.save_fusion(uuid,text,jsonb),public.delete_saved_fusion(uuid),public.set_video_signal(uuid,text,boolean),public.set_creator_follow(uuid,boolean),public.record_watch_completion(uuid,uuid,integer,boolean),public.submit_video_report(uuid,text,text),public.resolve_video_report(uuid,text,text),public.set_creator_suspension(uuid,boolean,text),public.submit_appeal(uuid,text),public.resolve_appeal(uuid,boolean,text),public.set_quota_override(uuid,integer,integer,timestamptz,text),public.ops_summary() to authenticated;
grant execute on function public.purge_operational_events(timestamptz) to service_role;
