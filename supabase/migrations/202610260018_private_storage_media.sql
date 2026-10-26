-- Private MP4 ingress. Existing rights, quota, immutable revision and review RPCs
-- remain authoritative; no browser may attest actual bytes or duration.
create table public.storage_media_uploads (
  reservation_id uuid primary key references public.upload_reservations(id),
  version_id uuid not null unique references public.video_versions(id),
  owner_id uuid not null references auth.users(id),
  bucket text not null default 'aiverse-videos' check(bucket='aiverse-videos'),
  object_path text not null unique,
  expected_bytes bigint not null check(expected_bytes between 1 and 50000000),
  actual_bytes bigint,
  duration_seconds integer,
  state text not null default 'reserved' check(state in ('reserved','pending_review','failed')),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  check(object_path=owner_id::text||'/'||version_id::text||'/'||reservation_id::text||'.mp4'),
  check(actual_bytes is null or actual_bytes=expected_bytes),
  check(duration_seconds is null or duration_seconds between 1 and 1200)
);
alter table public.storage_media_uploads enable row level security;
revoke all on public.storage_media_uploads from public,anon,authenticated,service_role;
grant select on public.storage_media_uploads to authenticated;
create policy storage_media_owner_read on public.storage_media_uploads for select to authenticated
  using(owner_id=auth.uid() and public.can_upload_media());

create function public.reserve_storage_video_upload(version_id uuid,idempotency_key text,file_size bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare hold jsonb; reservation public.upload_reservations; upload public.storage_media_uploads;
begin
  if file_size is null or file_size not between 1 and 50000000 then raise exception 'MP4 files must be at most 50 MB' using errcode='22023'; end if;
  -- Reuses verified-owner checks, owner/profile serialization, format limits and
  -- the exact existing daily/monthly reservation/idempotency contract.
  hold:=public.reserve_video_upload(version_id,idempotency_key);
  select * into reservation from public.upload_reservations r where r.id=(hold->>'reservation_id')::uuid for update;
  select * into upload from public.storage_media_uploads s where s.reservation_id=reservation.id;
  if found then
    if upload.expected_bytes<>file_size then raise exception 'Reservation file size is immutable' using errcode='22023'; end if;
  else
    if reservation.state<>'reserved' or reservation.operation_state<>'not_started'
      or exists(select 1 from public.private_media_assets a where a.reservation_id=reservation.id)
      then raise exception 'Unused reservation required' using errcode='22023'; end if;
    insert into public.storage_media_uploads(reservation_id,version_id,owner_id,object_path,expected_bytes)
      values(reservation.id,reservation.version_id,reservation.owner_id,
        reservation.owner_id::text||'/'||reservation.version_id::text||'/'||reservation.id::text||'.mp4',file_size)
      returning * into upload;
  end if;
  return jsonb_build_object('reservation_id',upload.reservation_id,'version_id',upload.version_id,
    'bucket',upload.bucket,'object_path',upload.object_path,'expires_at',reservation.expires_at,
    'max_duration_seconds',reservation.reserved_seconds,'file_size',upload.expected_bytes);
end;
$$;

-- Storage policies accept one sealed exact path, never an arbitrary owner prefix.
create function public.can_insert_storage_video(bucket_id text,object_name text) returns boolean
language sql stable security definer set search_path='' as $$
  select public.can_upload_media() and exists(
    select 1 from public.storage_media_uploads s join public.upload_reservations r on r.id=s.reservation_id
    join public.video_versions vv on vv.id=s.version_id join public.videos v on v.id=vv.video_id
    where s.bucket=bucket_id and s.object_path=object_name and s.owner_id=auth.uid()
      and s.state='reserved' and r.state='reserved' and r.operation_state='not_started' and r.expires_at>now()
      and v.owner_id=auth.uid() and v.state in ('draft','published') and v.latest_version_id=vv.id
      and vv.state='uploading');
$$;

create function public.complete_storage_video_upload(reservation_id uuid,actual_bytes bigint,duration_seconds integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare upload public.storage_media_uploads; reservation public.upload_reservations; video public.videos;
  version public.video_versions; object_metadata jsonb; stored_bytes bigint;
begin
  select * into upload from public.storage_media_uploads s where s.reservation_id=complete_storage_video_upload.reservation_id;
  if not found then raise exception 'Storage reservation unavailable' using errcode='22023'; end if;
  perform 1 from public.profiles where id=upload.owner_id for update;
  select v.* into video from public.videos v join public.video_versions vv on vv.video_id=v.id where vv.id=upload.version_id for update of v;
  select * into reservation from public.upload_reservations r where r.id=upload.reservation_id for update;
  select * into upload from public.storage_media_uploads s where s.reservation_id=complete_storage_video_upload.reservation_id for update;
  select * into version from public.video_versions vv where vv.id=upload.version_id;
  if video.owner_id is distinct from upload.owner_id or video.state in ('hidden','removed') or public.creator_is_suspended(upload.owner_id)
    or not exists(select 1 from auth.users u where u.id=upload.owner_id and u.email_confirmed_at is not null)
    then raise exception 'Verified active owner required' using errcode='42501'; end if;
  if actual_bytes is null or actual_bytes<>upload.expected_bytes or actual_bytes not between 1 and 50000000
    or duration_seconds is null or duration_seconds not between 1 and reservation.reserved_seconds
    or duration_seconds>(case when version.metadata->>'format'='movie' then 1200 when version.metadata->>'format'='reel' then 180 else 0 end)
    then raise exception 'Uploaded file exceeds its sealed reservation' using errcode='22023'; end if;
  -- Replays must still refer to the same actual sealed Storage object.
  select o.metadata into object_metadata from storage.objects o where o.bucket_id=upload.bucket and o.name=upload.object_path;
  if not found or coalesce(object_metadata->>'size','') !~ '^[0-9]{1,8}$'
    or object_metadata->>'mimetype' is distinct from 'video/mp4'
    then raise exception 'Uploaded MP4 object unavailable' using errcode='22023'; end if;
  stored_bytes:=(object_metadata->>'size')::bigint;
  if stored_bytes<>actual_bytes then raise exception 'Uploaded byte count mismatch' using errcode='22023'; end if;
  if upload.state='pending_review' then
    if upload.actual_bytes is distinct from actual_bytes or upload.duration_seconds is distinct from duration_seconds
      then raise exception 'Completion facts are immutable' using errcode='22023'; end if;
    return jsonb_build_object('state','pending_review','video_id',video.id,'version_id',version.id);
  end if;
  if upload.state<>'reserved' or reservation.state<>'reserved' or reservation.operation_state<>'not_started'
    or reservation.expires_at<=now() or video.latest_version_id is distinct from version.id or version.state<>'uploading'
    or exists(select 1 from public.private_media_assets a where a.reservation_id=reservation.id)
    then raise exception 'Current unexpired upload required' using errcode='22023'; end if;
  -- The privileged Edge verifier downloads/parses the actual MP4 bytes before
  -- calling this service-only RPC. It cannot replace sealed size/path facts.
  insert into public.private_media_assets(reservation_id,provider_uid,state)
    values(reservation.id,'supabase:'||reservation.id::text,'ready');
  update public.upload_reservations set state='consumed',consumed_seconds=duration_seconds,operation_state='bound' where id=reservation.id;
  update public.video_versions set state='pending_review',duration_seconds=complete_storage_video_upload.duration_seconds where id=version.id;
  update public.storage_media_uploads set state='pending_review',actual_bytes=complete_storage_video_upload.actual_bytes,
    duration_seconds=complete_storage_video_upload.duration_seconds,completed_at=now() where storage_media_uploads.reservation_id=reservation.id;
  return jsonb_build_object('state','pending_review','video_id',video.id,'version_id',version.id);
end;
$$;

create function public.fail_storage_video_upload(reservation_id uuid,reason text default 'invalid_file') returns void
language plpgsql security definer set search_path='' as $$
declare upload public.storage_media_uploads; reservation public.upload_reservations; video public.videos;
begin
  if reason is null or reason not in ('invalid_file','missing_file','verification_failed') then raise exception 'Invalid failure category' using errcode='22023'; end if;
  select * into upload from public.storage_media_uploads s where s.reservation_id=fail_storage_video_upload.reservation_id;
  if not found then raise exception 'Storage reservation unavailable' using errcode='22023'; end if;
  perform 1 from public.profiles where id=upload.owner_id for update;
  select v.* into video from public.videos v join public.video_versions vv on vv.video_id=v.id where vv.id=upload.version_id for update of v;
  select * into reservation from public.upload_reservations r where r.id=upload.reservation_id for update;
  select * into upload from public.storage_media_uploads s where s.reservation_id=fail_storage_video_upload.reservation_id for update;
  if upload.state='failed' then return; end if;
  if upload.state<>'reserved' or reservation.state<>'reserved' then raise exception 'Open storage upload required' using errcode='22023'; end if;
  -- Failed attempts consume the same conservative allowance as existing failed
  -- media operations. This prevents unlimited retries bypassing upload quotas.
  update public.storage_media_uploads set state='failed' where storage_media_uploads.reservation_id=reservation.id;
  update public.upload_reservations set state='consumed',consumed_seconds=reserved_seconds,operation_state='failed' where id=reservation.id;
  update public.video_versions set state='failed' where id=upload.version_id and state='uploading';
end;
$$;

create function public.storage_playback_entitlement(video_id uuid,requested_version_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare video public.videos; version public.video_versions; upload public.storage_media_uploads;
  selected uuid; public_playback boolean; window_seconds integer;
begin
  select * into video from public.videos v where v.id=storage_playback_entitlement.video_id;
  if not found or video.state in ('hidden','removed') or public.creator_is_suspended(video.owner_id) then return null; end if;
  selected:=coalesce(requested_version_id,case when video.state='published' then video.active_version_id else video.latest_version_id end);
  public_playback:=video.state='published' and selected=video.active_version_id;
  if not public_playback and (auth.uid() is null or not public.has_verified_email()
    or (auth.uid()<>video.owner_id and not public.can_review_media())) then return null; end if;
  select * into version from public.video_versions vv where vv.id=selected and vv.video_id=video.id and vv.state in ('pending_review','published');
  if not found or (public_playback and version.state<>'published') or version.duration_seconds is null
    or version.duration_seconds not between 1 and (case when version.metadata->>'format'='movie' then 1200 when version.metadata->>'format'='reel' then 180 else 0 end) then return null; end if;
  select s.* into upload from public.storage_media_uploads s join public.upload_reservations r on r.id=s.reservation_id
    join public.private_media_assets a on a.reservation_id=r.id
    where s.version_id=version.id and s.state='pending_review' and r.state='consumed'
      and a.state='ready' and a.provider_uid='supabase:'||r.id::text;
  if not found then return null; end if;
  window_seconds:=least(case when version.metadata->>'format'='movie' then 1260 else 300 end,greatest(60,version.duration_seconds+60));
  return jsonb_build_object('bucket',upload.bucket,'object_path',upload.object_path,'version_id',version.id,
    'duration_seconds',version.duration_seconds,'expires_at',now()+make_interval(secs=>window_seconds),'public_playback',public_playback);
end;
$$;

revoke all on function public.reserve_storage_video_upload(uuid,text,bigint),public.can_insert_storage_video(text,text),public.complete_storage_video_upload(uuid,bigint,integer),public.fail_storage_video_upload(uuid,text),public.storage_playback_entitlement(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.reserve_storage_video_upload(uuid,text,bigint),public.can_insert_storage_video(text,text) to authenticated;
grant execute on function public.storage_playback_entitlement(uuid,uuid) to anon,authenticated;
grant execute on function public.complete_storage_video_upload(uuid,bigint,integer),public.fail_storage_video_upload(uuid,text) to service_role;

-- Supabase manages the Storage schema. SQL-only legacy harnesses intentionally
-- omit it; policy/bootstrap work runs only where the managed tables exist.
do $bootstrap$
begin
  if to_regclass('storage.buckets') is not null and to_regclass('storage.objects') is not null then
    insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
      values('aiverse-videos','aiverse-videos',false,50000000,array['video/mp4'])
      on conflict(id) do update set public=false,file_size_limit=50000000,allowed_mime_types=array['video/mp4'];
    execute 'create policy aiverse_video_insert on storage.objects for insert to authenticated with check(bucket_id=''aiverse-videos'' and public.can_insert_storage_video(bucket_id,name))';
    -- Restrictive guards also seal this bucket if another application adds a
    -- broader permissive Storage policy later. Other buckets stay unchanged.
    execute 'create policy aiverse_video_insert_guard on storage.objects as restrictive for insert to authenticated with check(bucket_id<>''aiverse-videos'' or public.can_insert_storage_video(bucket_id,name))';
    execute 'create policy aiverse_video_anon_insert_guard on storage.objects as restrictive for insert to anon with check(bucket_id<>''aiverse-videos'')';
    -- Raw SELECT would let any permitted caller mint arbitrarily long signed
    -- URLs directly through Storage. Only the Edge service signs after bounded
    -- entitlement checks; owners and reviewers have no direct object read grant.
    execute 'create policy aiverse_video_select_guard on storage.objects as restrictive for select to authenticated using(bucket_id<>''aiverse-videos'')';
    execute 'create policy aiverse_video_anon_select_guard on storage.objects as restrictive for select to anon using(bucket_id<>''aiverse-videos'')';
    execute 'create policy aiverse_video_update_guard on storage.objects as restrictive for update to anon,authenticated using(bucket_id<>''aiverse-videos'') with check(bucket_id<>''aiverse-videos'')';
    execute 'create policy aiverse_video_delete_guard on storage.objects as restrictive for delete to anon,authenticated using(bucket_id<>''aiverse-videos'')';
  end if;
end;
$bootstrap$;

-- Legacy Stream operations must never lease, bind, poll or delete Storage media.

create or replace function public.begin_upload_grant(reservation_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare reservation public.upload_reservations; leased boolean:=false; video public.videos;
begin
  select * into reservation from public.upload_reservations where id=reservation_id;
  if not found then raise exception 'Reservation not found' using errcode='22023'; end if;
  perform 1 from public.profiles where id=reservation.owner_id for update;
  select v.* into video from public.videos v join public.video_versions vv on vv.video_id=v.id where vv.id=reservation.version_id for update of v;
  select * into reservation from public.upload_reservations where id=reservation_id for update;
  if not exists(select 1 from public.storage_media_uploads s where s.reservation_id=reservation.id) and reservation.state='reserved' and reservation.operation_state='not_started' and reservation.expires_at>now()
    and video.state not in ('hidden','removed') and video.latest_version_id=reservation.version_id
    and not public.creator_is_suspended(reservation.owner_id)
    and exists(select 1 from auth.users u where u.id=reservation.owner_id and u.email_confirmed_at is not null) then
    update public.upload_reservations set operation_state='granting' where id=reservation_id;
    insert into public.upload_operations(reservation_id) values(reservation_id);
    leased:=true; reservation.operation_state:='granting';
  end if;
  return jsonb_build_object('lease',leased,'reservation_id',reservation.id,'operation_key',reservation.id,'operation_state',reservation.operation_state,'provider_uid',(select provider_uid from public.private_media_assets where private_media_assets.reservation_id=reservation.id));
end;
$$;

create or replace function public.bind_video_provider(reservation_id uuid,provider_uid text) returns jsonb language plpgsql security definer set search_path='' as $$
declare reservation public.upload_reservations; existing public.private_media_assets; asset_id uuid; video public.videos; version public.video_versions; usable boolean;
begin
  if provider_uid is null or char_length(provider_uid) not between 1 and 256 then raise exception 'Invalid provider ID' using errcode='22023'; end if;
  select * into reservation from public.upload_reservations r where r.id=reservation_id;
  if not found then raise exception 'Reservation not found' using errcode='22023'; end if;
  perform 1 from public.profiles where id=reservation.owner_id for update;
  select v.* into video from public.videos v join public.video_versions vv on vv.video_id=v.id where vv.id=reservation.version_id for update of v;
  select * into reservation from public.upload_reservations r where r.id=reservation_id for update;
  select * into version from public.video_versions vv where vv.id=reservation.version_id;
  if exists(select 1 from public.storage_media_uploads s where s.reservation_id=reservation.id) then raise exception 'Storage reservation cannot bind a Stream provider' using errcode='22023'; end if;
  select * into existing from public.private_media_assets a where a.reservation_id=bind_video_provider.reservation_id;
  if found then
    if existing.provider_uid<>bind_video_provider.provider_uid then raise exception 'Provider binding conflict' using errcode='22023'; end if;
    asset_id:=existing.id;
    -- Rebinding an already reconciled asset cannot authorize a new upload, and
    -- must not delete the still-approved public version during a later revision.
    if reservation.state='consumed' then return jsonb_build_object('usable',false); end if;
  else
    insert into public.private_media_assets(reservation_id,provider_uid) values(reservation_id,provider_uid) returning id into asset_id;
  end if;
  usable:=reservation.expires_at>now() and reservation.state in ('reserved','bound')
    and reservation.operation_state in ('granting','uncertain','bound')
    and video.state in ('draft','published') and video.latest_version_id=reservation.version_id
    and version.state in ('uploading','processing') and not public.creator_is_suspended(reservation.owner_id)
    and exists(select 1 from auth.users u where u.id=reservation.owner_id and u.email_confirmed_at is not null);
  if usable then
    update public.upload_reservations set state='bound',operation_state='bound' where id=reservation_id;
    update public.video_versions set state='processing' where id=reservation.version_id and state='uploading';
  else
    update public.upload_reservations set state='expired',operation_state='bound' where id=reservation_id;
    update public.video_versions set state='failed' where id=reservation.version_id and state in ('draft','uploading','processing','pending_review');
    perform public.queue_media_deletion(asset_id);
  end if;
  return jsonb_build_object('usable',coalesce(usable,false));
end;
$$;

create or replace function public.claim_media_processing(batch_size integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare claimed_assets jsonb;
begin
  with candidates as (
    select a.id from public.private_media_assets a
    join public.upload_reservations r on r.id=a.reservation_id
    join public.video_versions vv on vv.id=r.version_id
    join public.videos v on v.id=vv.video_id
    where a.provider_uid not like 'supabase:%' and a.state='processing' and (a.poll_lease_until is null or a.poll_lease_until<=now())
      and r.state='bound' and r.operation_state='bound' and r.expires_at>now()
      and vv.state='processing' and v.state in ('draft','published') and v.latest_version_id=vv.id
      and not public.creator_is_suspended(r.owner_id)
      and exists(select 1 from auth.users u where u.id=r.owner_id and u.email_confirmed_at is not null)
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

create or replace function public.claim_media_deletions(batch_size integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare jobs jsonb;
begin
  perform public.expire_upload_reservations();
  update public.media_deletion_jobs set state='exhausted' where attempts>=10 and state<>'completed' and (lease_until is null or lease_until<=now());
  with candidates as (
    select id from public.media_deletion_jobs where exists(select 1 from public.private_media_assets a where a.id=asset_id and a.provider_uid not like 'supabase:%') and attempts<10 and
    ((state in ('pending','retry') and next_attempt_at<=now()) or (state='processing' and lease_until<=now()))
    order by next_attempt_at for update skip locked limit greatest(1,least(coalesce(batch_size,10),50))
  ), claimed as (
    update public.media_deletion_jobs j set state='processing',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes'
    from candidates c where j.id=c.id returning j.*
  ) select coalesce(jsonb_agg(jsonb_build_object('job_id',c.id,'lease_token',c.lease_token,'provider_uid',a.provider_uid,'attempts',c.attempts)),'[]'::jsonb)
    into jobs from claimed c join public.private_media_assets a on a.id=c.asset_id;
  return jobs;
end;
$$;

revoke all on function public.begin_upload_grant(uuid),public.bind_video_provider(uuid,text),public.claim_media_processing(integer),public.claim_media_deletions(integer) from public,anon,authenticated,service_role;
grant execute on function public.begin_upload_grant(uuid),public.bind_video_provider(uuid,text),public.claim_media_processing(integer),public.claim_media_deletions(integer) to service_role;
