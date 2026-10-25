-- Telemetry is a bounded retention signal, not a verified view count. The server
-- opens a session only after issuing a real public provider playback grant.
create table public.playback_sessions (
  session_key uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  video_id uuid not null references public.videos(id),
  version_id uuid not null references public.video_versions(id),
  duration_seconds integer not null check(duration_seconds between 1 and 180),
  opened_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  watched_seconds integer not null default 0 check(watched_seconds between 0 and 180),
  updated_at timestamptz not null default clock_timestamp(),
  check(expires_at>opened_at),
  check(watched_seconds<=duration_seconds)
);
create index playback_sessions_owner_day on public.playback_sessions(user_id,opened_at);
create index playback_sessions_expiry on public.playback_sessions(expires_at);
alter table public.playback_sessions enable row level security;
revoke all on public.playback_sessions from public,anon,authenticated;

-- Add only public version/duration facts; provider identifiers remain internal.
create or replace function public.playback_entitlement(video_id uuid,viewer_id uuid,requested_version_id uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare video public.videos; selected_version_id uuid; provider_uid text; may_review boolean; verified_duration integer; window_seconds integer;
begin
  select * into video from public.videos where id=video_id;
  if not found or video.state in ('hidden','removed') or public.creator_is_suspended(video.owner_id) then return null; end if;
  select exists(select 1 from public.user_roles where user_id=viewer_id and role in ('moderator','admin')) into may_review;
  selected_version_id:=coalesce(requested_version_id,case when video.state='published' then video.active_version_id else video.latest_version_id end);
  if selected_version_id is distinct from video.active_version_id or video.state<>'published' then
    if viewer_id is null or (viewer_id<>video.owner_id and not may_review) then return null; end if;
  end if;
  select vv.duration_seconds into verified_duration from public.video_versions vv where vv.id=selected_version_id and vv.video_id=video.id and vv.state in ('pending_review','published');
  if not found then return null; end if;
  select a.provider_uid into provider_uid from public.private_media_assets a join public.upload_reservations r on r.id=a.reservation_id where r.version_id=selected_version_id and a.state='ready';
  if provider_uid is null then return null; end if;
  window_seconds:=least(300,greatest(60,coalesce(verified_duration,0)::bigint+60))::integer;
  return jsonb_build_object('provider_uid',provider_uid,'version_id',selected_version_id,'duration_seconds',verified_duration,'public_playback',video.state='published' and selected_version_id=video.active_version_id,'expires_at',now()+make_interval(secs=>window_seconds));
end;
$$;

create function public.open_playback_session(viewer_id uuid,video_id uuid,version_id uuid,expires_at timestamptz) returns jsonb language plpgsql security definer set search_path='' as $$
declare entitlement jsonb; session public.playback_sessions; stamp timestamptz:=clock_timestamp(); duration integer;
begin
  if viewer_id is null or not exists(select 1 from auth.users u where u.id=viewer_id and u.email_confirmed_at is not null) then return null; end if;
  -- Shared lock also serializes daily-credit decisions across multiple sessions.
  perform pg_advisory_xact_lock(hashtextextended(viewer_id::text,8913));
  perform p.id from public.profiles p join public.videos v on v.owner_id=p.id where v.id=video_id for share of p;
  perform v.id from public.videos v where v.id=video_id for share;
  stamp:=clock_timestamp();
  entitlement:=public.playback_entitlement(video_id,viewer_id,version_id);
  if entitlement is null or (entitlement->>'public_playback') is distinct from 'true' or (entitlement->>'version_id')::uuid is distinct from version_id then return null; end if;
  duration:=(entitlement->>'duration_seconds')::integer;
  if duration is null or duration not between 1 and 180 or expires_at is null or expires_at<=stamp or expires_at>stamp+interval '300 seconds' or expires_at>(entitlement->>'expires_at')::timestamptz then return null; end if;
  if (select count(*) from public.playback_sessions s where s.user_id=viewer_id and s.opened_at>=date_trunc('day',stamp at time zone 'UTC') at time zone 'UTC')>=30 then return null; end if;
  insert into public.playback_sessions(user_id,video_id,version_id,duration_seconds,opened_at,updated_at,expires_at)
    values(viewer_id,video_id,version_id,duration,stamp,stamp,expires_at) returning * into session;
  return jsonb_build_object('sessionKey',session.session_key,'accountId',viewer_id,'versionId',version_id);
end;
$$;

create function public.record_playback_progress(video_id uuid,session_key uuid,watched_seconds integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare session public.playback_sessions; entitlement jsonb; stamp timestamptz:=clock_timestamp(); credit boolean; previous public.watch_completions; day date;
begin
  if auth.uid() is null or not exists(select 1 from auth.users u where u.id=auth.uid() and u.email_confirmed_at is not null) then raise exception 'Verified account required' using errcode='42501'; end if;
  if session_key is null or video_id is null or watched_seconds is null or watched_seconds not between 1 and 180 then raise exception 'Invalid playback progress' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,8913));
  select * into session from public.playback_sessions s where s.session_key=record_playback_progress.session_key and s.user_id=auth.uid() and s.video_id=record_playback_progress.video_id for update;
  if not found then raise exception 'Playback session unavailable' using errcode='42501'; end if;
  perform p.id from public.profiles p join public.videos v on v.owner_id=p.id where v.id=video_id for share of p;
  perform v.id from public.videos v where v.id=video_id for share;
  stamp:=clock_timestamp();
  if session.expires_at<=stamp then raise exception 'Playback session unavailable' using errcode='42501'; end if;
  entitlement:=public.playback_entitlement(video_id,auth.uid(),session.version_id);
  if entitlement is null or (entitlement->>'public_playback') is distinct from 'true' or (entitlement->>'version_id')::uuid is distinct from session.version_id then raise exception 'Published version changed' using errcode='42501'; end if;
  -- Two seconds TOTAL slack accommodates integer rounding/event transit. Neither
  -- seeking nor repeated rapid submissions can increase the total wall-time cap.
  -- Do not bound deltas by server receipt intervals: network-delayed reports
  -- can arrive close together despite representing distinct playback intervals.
  if watched_seconds<session.watched_seconds or watched_seconds>session.duration_seconds or watched_seconds>floor(extract(epoch from (stamp-session.opened_at)))+2 then raise exception 'Implausible playback progress' using errcode='22023'; end if;
  select * into previous from public.watch_completions w where w.user_id=auth.uid() and w.session_key=record_playback_progress.session_key;
  if found and (previous.video_id<>video_id or previous.version_id<>session.version_id) then raise exception 'Playback record mismatch' using errcode='42501'; end if;
  -- Keep the first accepted activity's UTC day stable across midnight/retries.
  day:=coalesce(previous.recorded_day,(stamp at time zone 'UTC')::date);
  credit:=coalesce(previous.credited,false) or (watched_seconds*100>=session.duration_seconds*90 and not exists(select 1 from public.watch_completions w where w.user_id=auth.uid() and w.video_id=record_playback_progress.video_id and w.recorded_day=day and w.credited));
  insert into public.watch_completions(user_id,session_key,video_id,version_id,watched_seconds,duration_seconds,user_initiated,credited,recorded_day)
    values(auth.uid(),session_key,video_id,session.version_id,watched_seconds,session.duration_seconds,true,credit,day)
    on conflict on constraint watch_completions_pkey do update set watched_seconds=excluded.watched_seconds,credited=excluded.credited;
  -- Equal retries must not consume the next report's elapsed interval.
  if watched_seconds>session.watched_seconds then
    update public.playback_sessions s set watched_seconds=record_playback_progress.watched_seconds,updated_at=stamp where s.session_key=record_playback_progress.session_key;
  end if;
  return jsonb_build_object('watchedSeconds',watched_seconds,'credited',credit);
end;
$$;

-- Preserve the old Library API shape while closing arbitrary client session keys.
create or replace function public.record_watch_completion(video_id uuid,session_key uuid,watched_seconds integer,user_initiated boolean) returns void language plpgsql security definer set search_path='' as $$
begin
  if user_initiated is distinct from true then raise exception 'Explicit playback required' using errcode='22023'; end if;
  perform public.record_playback_progress(video_id,session_key,watched_seconds);
end;
$$;
revoke all on function public.playback_entitlement(uuid,uuid,uuid),public.open_playback_session(uuid,uuid,uuid,timestamptz),public.record_playback_progress(uuid,uuid,integer),public.record_watch_completion(uuid,uuid,integer,boolean) from public,anon,authenticated;
grant execute on function public.playback_entitlement(uuid,uuid,uuid),public.open_playback_session(uuid,uuid,uuid,timestamptz) to service_role;
grant execute on function public.record_playback_progress(uuid,uuid,integer),public.record_watch_completion(uuid,uuid,integer,boolean) to authenticated;

-- Reuse the existing operator-approved cutoff and bounded worker path; do not
-- invent a new retention schedule or keep expired session identifiers forever.
create or replace function public.purge_operational_events(cutoff timestamptz) returns jsonb language plpgsql security definer set search_path='' as $$
declare watch_deleted integer; events_deleted integer; sessions_deleted integer;
begin
  if cutoff is null or cutoff>now()-interval '1 day' or cutoff<now()-interval '365 days' then raise exception 'Retention cutoff must retain 1 to 365 days' using errcode='22023'; end if;
  with obsolete as (select user_id,session_key from public.watch_completions where created_at<cutoff order by created_at limit 1000 for update skip locked)
    delete from public.watch_completions w using obsolete o where w.user_id=o.user_id and w.session_key=o.session_key;
  get diagnostics watch_deleted=row_count;
  with obsolete as (select e.event_key from public.provider_events e where e.created_at<cutoff and exists(select 1 from public.private_media_assets a where a.provider_uid=e.provider_uid and a.state='deleted') order by e.created_at limit 1000 for update skip locked)
    delete from public.provider_events e using obsolete o where e.event_key=o.event_key;
  get diagnostics events_deleted=row_count;
  with obsolete as (select s.session_key from public.playback_sessions s where s.opened_at<cutoff and s.expires_at<now() order by s.opened_at limit 1000 for update skip locked)
    delete from public.playback_sessions s using obsolete o where s.session_key=o.session_key;
  get diagnostics sessions_deleted=row_count;
  return jsonb_build_object('watch_events',watch_deleted,'terminal_provider_events',events_deleted,'playback_sessions',sessions_deleted);
end;
$$;
revoke all on function public.purge_operational_events(timestamptz) from public,anon,authenticated;
grant execute on function public.purge_operational_events(timestamptz) to service_role;
