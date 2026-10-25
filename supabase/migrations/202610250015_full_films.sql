-- Movies may occupy up to twenty minutes; Reels retain the three-minute bound.
-- Quota remains three uploads/day and thirty minutes/month unless explicitly overridden.
create or replace function public.get_upload_limits(target uuid) returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('daily_uploads',coalesce(o.daily_uploads,3),'monthly_seconds',coalesce(o.monthly_seconds,1800),'max_duration_seconds',180,'movie_max_duration_seconds',1200)
    from (select 1) base left join public.quota_overrides o on o.creator_id=target and o.expires_at>now();
$$;


create or replace function public.reserve_video_upload(version_id uuid,idempotency_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare video public.videos; version public.video_versions; reservation public.upload_reservations; used_seconds bigint; uploads bigint; limits jsonb; max_seconds integer; remaining_seconds bigint;
begin
  if auth.uid() is null or not public.is_creator() then raise exception 'Approved creator required' using errcode='42501'; end if;
  if idempotency_key is null or char_length(idempotency_key) not between 8 and 100 then raise exception 'Invalid operation key' using errcode='22023'; end if;
  -- Serializes all reservations for this owner, including separate simultaneous videos.
  perform 1 from public.profiles where id=auth.uid() for update;
  if not public.is_creator() then raise exception 'Approved creator required' using errcode='42501'; end if;
  limits:=public.get_upload_limits(auth.uid()); max_seconds:=(limits->>'max_duration_seconds')::integer;
  if max_seconds is null or max_seconds not between 1 and 1800 or (limits->>'daily_uploads')::integer is null or (limits->>'monthly_seconds')::integer is null then raise exception 'Invalid upload policy' using errcode='22023'; end if;
  select * into reservation from public.upload_reservations r where r.owner_id=auth.uid() and r.idempotency_key=reserve_video_upload.idempotency_key;
  if found then
    if reservation.version_id<>version_id then raise exception 'Idempotency key belongs to another version' using errcode='22023'; end if;
  else
    select * into version from public.video_versions where id=version_id;
    select * into video from public.videos where id=version.video_id for update;
    if video.id is null or video.owner_id<>auth.uid() then raise exception 'Own video required' using errcode='42501'; end if;
    if video.state in ('removed','hidden') or video.latest_version_id<>version_id or version.state<>'draft' then raise exception 'Current draft required' using errcode='22023'; end if;
    if version.metadata->>'format' not in ('reel','movie') then raise exception 'Invalid video format' using errcode='22023'; end if;
    max_seconds:=case when version.metadata->>'format'='movie' then least(1200,(limits->>'movie_max_duration_seconds')::integer) else least(180,(limits->>'max_duration_seconds')::integer) end;
    if max_seconds is null or max_seconds<1 then raise exception 'Invalid upload policy' using errcode='22023'; end if;
    -- Expired holds do not consume entitlement; their provider assets are queued by expiry/reconciliation.
    select count(*) into uploads from public.upload_reservations r where r.owner_id=auth.uid() and r.created_at >= date_trunc('day',now() at time zone 'UTC') at time zone 'UTC' and (r.state='consumed' or (r.state in ('reserved','bound') and r.expires_at>now()));
    select coalesce(sum(case when r.state='consumed' then r.consumed_seconds else r.reserved_seconds end),0) into used_seconds from public.upload_reservations r where r.owner_id=auth.uid() and r.created_at >= date_trunc('month',now() at time zone 'UTC') at time zone 'UTC' and (r.state='consumed' or (r.state in ('reserved','bound') and r.expires_at>now()));
    remaining_seconds:=(limits->>'monthly_seconds')::bigint-used_seconds;
    if uploads>=(limits->>'daily_uploads')::integer or remaining_seconds<1 then raise exception 'Upload quota exceeded' using errcode='22023'; end if;
    max_seconds:=least(max_seconds,remaining_seconds)::integer;
    insert into public.upload_reservations(owner_id,version_id,idempotency_key,reserved_seconds) values(auth.uid(),version_id,idempotency_key,max_seconds) returning * into reservation;
    update public.video_versions set state='uploading' where id=version_id;
  end if;
  -- Browser-callable RPC never returns the private provider identifier. The internal
  -- grant lease provides it to the trusted server when recovering an operation.
  return jsonb_build_object('reservation_id',reservation.id,'version_id',reservation.version_id,'expires_at',reservation.expires_at,'max_duration_seconds',reservation.reserved_seconds,'state',reservation.state,'operation_state',reservation.operation_state,'provider_uid',null);
end;
$$;

create or replace function public.reconcile_video_provider(event_key text,provider_uid text,provider_state text,actual_duration_seconds integer,operation_key uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare asset public.private_media_assets; reservation public.upload_reservations; version public.video_versions; video public.videos; prior_event public.provider_events;
begin
  if event_key is null or char_length(event_key) not between 1 and 256 or provider_state is null or provider_state not in ('ready','failed') then raise exception 'Invalid provider event' using errcode='22023'; end if;
  select * into prior_event from public.provider_events p where p.event_key=reconcile_video_provider.event_key;
  if found then
    if prior_event.provider_uid<>provider_uid or prior_event.provider_state<>provider_state or prior_event.duration_seconds is distinct from actual_duration_seconds then raise exception 'Event key conflict' using errcode='22023'; end if;
    return jsonb_build_object('duplicate',true);
  end if;
  select * into asset from public.private_media_assets a where a.provider_uid=reconcile_video_provider.provider_uid;
  if not found and operation_key is not null then
    perform public.bind_video_provider(operation_key,provider_uid);
    select * into asset from public.private_media_assets a where a.provider_uid=reconcile_video_provider.provider_uid;
  end if;
  if asset.id is null then raise exception 'Unknown provider operation' using errcode='22023'; end if;
  select * into reservation from public.upload_reservations r where r.id=asset.reservation_id;
  select * into version from public.video_versions vv where vv.id=reservation.version_id;
  -- Parent-first order matches moderation/binding. Lock the asset only after
  -- its video and reservation, then read its latest terminal deletion state.
  select * into video from public.videos v where v.id=version.video_id for update;
  select * into reservation from public.upload_reservations r where r.id=asset.reservation_id for update;
  select * into asset from public.private_media_assets a where a.id=asset.id for update;
  insert into public.provider_events(event_key,provider_uid,provider_state,duration_seconds) values(event_key,provider_uid,provider_state,actual_duration_seconds);
  if asset.state in ('deleting','deleted') or exists(select 1 from public.media_deletion_jobs j where j.asset_id=asset.id) then
    return jsonb_build_object('ignored',true,'reason','asset_deletion_queued');
  end if;
  if video.state in ('removed','hidden') or public.creator_is_suspended(video.owner_id) or version.state in ('removed','failed','rejected') or reservation.state in ('expired','cancelled') or (reservation.state<>'consumed' and reservation.expires_at<=now()) then
    if reservation.state<>'consumed' then update public.upload_reservations set state='expired' where id=reservation.id; end if;
    perform public.queue_media_deletion(asset.id);
    return jsonb_build_object('ignored',true,'reason','unavailable_or_expired');
  end if;
  if reservation.state='consumed' then return jsonb_build_object('ignored',true,'reason','already_reconciled'); end if;
  if provider_state='ready' and actual_duration_seconds between 1 and reservation.reserved_seconds
    and actual_duration_seconds<=(case when version.metadata->>'format'='movie' then 1200 when version.metadata->>'format'='reel' then 180 else 0 end) then
    update public.private_media_assets set state='ready',poll_lease_until=null where id=asset.id;
    update public.upload_reservations set state='consumed',consumed_seconds=actual_duration_seconds where id=reservation.id;
    update public.video_versions set state='pending_review',duration_seconds=actual_duration_seconds where id=version.id;
    return jsonb_build_object('state','pending_review');
  end if;
  update public.private_media_assets set state='failed',poll_lease_until=null where id=asset.id;
  update public.upload_reservations set state='consumed',consumed_seconds=reservation.reserved_seconds where id=reservation.id;
  update public.video_versions set state='failed' where id=version.id;
  perform public.queue_media_deletion(asset.id);
  return jsonb_build_object('state','failed');
end;
$$;

-- Existing retained rows remain valid. Public RPCs additionally bind the immutable format.
alter table public.watch_completions drop constraint watch_completions_watched_seconds_check;
alter table public.watch_completions add constraint watch_completions_watched_seconds_check check(watched_seconds between 1 and 1200);
alter table public.watch_completions drop constraint watch_completions_duration_seconds_check;
alter table public.watch_completions add constraint watch_completions_duration_seconds_check check(duration_seconds between 1 and 1200);
alter table public.playback_sessions drop constraint playback_sessions_duration_seconds_check;
alter table public.playback_sessions add constraint playback_sessions_duration_seconds_check check(duration_seconds between 1 and 1200);
alter table public.playback_sessions drop constraint playback_sessions_watched_seconds_check;
alter table public.playback_sessions add constraint playback_sessions_watched_seconds_check check(watched_seconds between 0 and 1200);


create or replace function public.playback_entitlement(video_id uuid,viewer_id uuid,requested_version_id uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare video public.videos; selected_version_id uuid; provider_uid text; may_review boolean; verified_duration integer; window_seconds integer; selected_format text;
begin
  select * into video from public.videos where id=video_id;
  if not found or video.state in ('hidden','removed') or public.creator_is_suspended(video.owner_id) then return null; end if;
  select exists(select 1 from public.user_roles where user_id=viewer_id and role in ('moderator','admin')) into may_review;
  selected_version_id:=coalesce(requested_version_id,case when video.state='published' then video.active_version_id else video.latest_version_id end);
  if selected_version_id is distinct from video.active_version_id or video.state<>'published' then
    if viewer_id is null or (viewer_id<>video.owner_id and not may_review) then return null; end if;
  end if;
  select vv.duration_seconds,vv.metadata->>'format' into verified_duration,selected_format from public.video_versions vv where vv.id=selected_version_id and vv.video_id=video.id and vv.state in ('pending_review','published');
  if not found or verified_duration is null or verified_duration<1 or verified_duration>(case when selected_format='movie' then 1200 when selected_format='reel' then 180 else 0 end) then return null; end if;
  select a.provider_uid into provider_uid from public.private_media_assets a join public.upload_reservations r on r.id=a.reservation_id where r.version_id=selected_version_id and a.state='ready';
  if provider_uid is null then return null; end if;
  window_seconds:=least(case when selected_format='movie' then 1260 else 300 end,greatest(60,coalesce(verified_duration,0)::bigint+60))::integer;
  return jsonb_build_object('provider_uid',provider_uid,'version_id',selected_version_id,'duration_seconds',verified_duration,'public_playback',video.state='published' and selected_version_id=video.active_version_id,'expires_at',now()+make_interval(secs=>window_seconds));
end;
$$;

create or replace function public.open_playback_session(viewer_id uuid,video_id uuid,version_id uuid,expires_at timestamptz) returns jsonb language plpgsql security definer set search_path='' as $$
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
  if duration is null or duration not between 1 and 1200 or expires_at is null or expires_at<=stamp or expires_at>stamp+interval '1260 seconds' or expires_at>(entitlement->>'expires_at')::timestamptz then return null; end if;
  if (select count(*) from public.playback_sessions s where s.user_id=viewer_id and s.opened_at>=date_trunc('day',stamp at time zone 'UTC') at time zone 'UTC')>=30 then return null; end if;
  insert into public.playback_sessions(user_id,video_id,version_id,duration_seconds,opened_at,updated_at,expires_at)
    values(viewer_id,video_id,version_id,duration,stamp,stamp,expires_at) returning * into session;
  return jsonb_build_object('sessionKey',session.session_key,'accountId',viewer_id,'versionId',version_id);
end;
$$;

create or replace function public.record_playback_progress(video_id uuid,session_key uuid,watched_seconds integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare session public.playback_sessions; entitlement jsonb; stamp timestamptz:=clock_timestamp(); credit boolean; previous public.watch_completions; day date;
begin
  if auth.uid() is null or not exists(select 1 from auth.users u where u.id=auth.uid() and u.email_confirmed_at is not null) then raise exception 'Verified account required' using errcode='42501'; end if;
  if session_key is null or video_id is null or watched_seconds is null or watched_seconds not between 1 and 1200 then raise exception 'Invalid playback progress' using errcode='22023'; end if;
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

-- CREATE OR REPLACE retains grants; explicitly keep privileged provider/session hooks private.
revoke all on function public.get_upload_limits(uuid),public.reconcile_video_provider(text,text,text,integer,uuid),public.playback_entitlement(uuid,uuid,uuid),public.open_playback_session(uuid,uuid,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.get_upload_limits(uuid),public.reconcile_video_provider(text,text,text,integer,uuid),public.playback_entitlement(uuid,uuid,uuid),public.open_playback_session(uuid,uuid,uuid,timestamptz) to service_role;
