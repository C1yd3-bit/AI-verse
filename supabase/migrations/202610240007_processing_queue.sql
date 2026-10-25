alter table public.private_media_assets add column last_polled_at timestamptz;
alter table public.private_media_assets add column poll_lease_until timestamptz;
create index media_processing_poll_order on public.private_media_assets(last_polled_at nulls first,created_at,id) where state='processing';

create or replace function public.queue_media_deletion(asset_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
  update public.private_media_assets a set state='deleting',poll_lease_until=null where a.id=asset_id and a.state<>'deleted';
  -- Never reset another worker's lease, attempts, backoff or exhaustion state.
  insert into public.media_deletion_jobs(asset_id) values(asset_id) on conflict on constraint media_deletion_jobs_asset_id_key do nothing;
end;
$$;
-- Correct pre-migration rows, including assets whose deletion retries exhausted.
update public.private_media_assets a set state='deleting',poll_lease_until=null
  where a.state<>'deleted' and exists(select 1 from public.media_deletion_jobs j where j.asset_id=a.id);

create function public.claim_media_processing(batch_size integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare claimed_assets jsonb;
begin
  with candidates as (
    select a.id from public.private_media_assets a
    join public.upload_reservations r on r.id=a.reservation_id
    join public.video_versions vv on vv.id=r.version_id
    join public.videos v on v.id=vv.video_id
    where a.state='processing' and (a.poll_lease_until is null or a.poll_lease_until<=now())
      and r.state='bound' and r.operation_state='bound' and r.expires_at>now()
      and vv.state='processing' and v.state in ('draft','published') and v.latest_version_id=vv.id
      and not public.creator_is_suspended(r.owner_id)
      and exists(select 1 from public.user_roles ur where ur.user_id=r.owner_id and ur.role='creator')
      and not exists(select 1 from public.media_deletion_jobs j where j.asset_id=a.id)
    order by a.last_polled_at nulls first,a.created_at,a.id
    limit greatest(1,least(coalesce(batch_size,10),50)) for update of a skip locked
  ), claimed as (
    update public.private_media_assets a set last_polled_at=now(),poll_lease_until=now()+interval '2 minutes'
    from candidates c where a.id=c.id returning a.id,a.provider_uid,a.created_at
  ) select coalesce(jsonb_agg(jsonb_build_object('asset_id',c.id,'provider_uid',c.provider_uid) order by c.created_at,c.id),'[]'::jsonb)
    into claimed_assets from claimed c;
  return claimed_assets;
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
  if provider_state='ready' and actual_duration_seconds between 1 and reservation.reserved_seconds then
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

revoke all on function public.queue_media_deletion(uuid),public.claim_media_processing(integer),public.reconcile_video_provider(text,text,text,integer,uuid) from public,anon,authenticated;
grant execute on function public.claim_media_processing(integer),public.reconcile_video_provider(text,text,text,integer,uuid) to service_role;
