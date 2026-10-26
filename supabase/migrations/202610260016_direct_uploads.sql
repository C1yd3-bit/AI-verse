-- Direct upload eligibility is independent of legacy creator/application roles.
-- Verified identity, suspension, ownership, quotas and video review remain enforced.
create function public.can_upload_media() returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and public.has_verified_email() and not public.creator_is_suspended(auth.uid());
$$;
revoke all on function public.can_upload_media() from public,anon,authenticated,service_role;
grant execute on function public.can_upload_media() to authenticated;

create or replace function public.create_video_version(video_id uuid,metadata jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare target public.videos; version_id uuid; revision_number integer;
begin
  if not public.can_upload_media() then raise exception 'Verified unsuspended account required' using errcode='42501'; end if;
  perform 1 from public.profiles where id=auth.uid() for update;
  if not public.can_upload_media() then raise exception 'Verified unsuspended account required' using errcode='42501'; end if;
  perform public.validate_video_metadata(metadata);
  if video_id is null then insert into public.videos(owner_id) values(auth.uid()) returning * into target;
  else select * into target from public.videos v where v.id=video_id for update;
    if not found or target.owner_id<>auth.uid() then raise exception 'Own video required' using errcode='42501'; end if;
    if target.state in ('hidden','removed') then raise exception 'Video unavailable for revision' using errcode='22023'; end if;
  end if;
  select coalesce(max(revision),0)+1 into revision_number from public.video_versions where video_versions.video_id=target.id;
  insert into public.video_versions(video_id,revision,metadata) values(target.id,revision_number,metadata) returning id into version_id;
  insert into public.video_languages(version_id,language_slug) select version_id,value from jsonb_array_elements_text(metadata->'languages');
  update public.videos set latest_version_id=version_id where id=target.id;
  return jsonb_build_object('video_id',target.id,'version_id',version_id);
end;
$$;

create or replace function public.reserve_video_upload(version_id uuid,idempotency_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare video public.videos; version public.video_versions; reservation public.upload_reservations; used_seconds bigint; uploads bigint; limits jsonb; max_seconds integer; remaining_seconds bigint;
begin
  if not public.can_upload_media() then raise exception 'Verified unsuspended account required' using errcode='42501'; end if;
  if idempotency_key is null or char_length(idempotency_key) not between 8 and 100 then raise exception 'Invalid operation key' using errcode='22023'; end if;
  -- Serializes all reservations for this owner, including separate simultaneous videos.
  perform 1 from public.profiles where id=auth.uid() for update;
  if not public.can_upload_media() then raise exception 'Verified unsuspended account required' using errcode='42501'; end if;
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

create or replace function public.can_edit_version_artwork(version_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select public.can_upload_media()
    and exists(select 1 from public.video_versions vv join public.videos v on v.id=vv.video_id
      where vv.id=$1 and v.owner_id=auth.uid() and v.latest_version_id=vv.id
        and v.state in ('draft','published') and vv.state='draft'
        and not exists(select 1 from public.upload_reservations r where r.version_id=vv.id));
$$;

create or replace function public.set_version_artwork(target_account uuid,version_id uuid,image_data text) returns void
language plpgsql security definer set search_path='' as $$
declare video public.videos; version public.video_versions;
begin
  -- target_account is supplied solely by the verified server session, never input JSON.
  if target_account is null then raise exception 'Verified unsuspended account required' using errcode='42501'; end if;
  perform 1 from public.profiles where id=target_account for update;
  if not exists(select 1 from auth.users u where u.id=target_account and u.email_confirmed_at is not null)
    or public.creator_is_suspended(target_account) then raise exception 'Verified unsuspended account required' using errcode='42501'; end if;
  select * into version from public.video_versions vv where vv.id=set_version_artwork.version_id;
  select * into video from public.videos v where v.id=version.video_id for update;
  if video.id is null or video.owner_id<>target_account then raise exception 'Own video required' using errcode='42501'; end if;
  -- Re-read after video lock: reserve/review/revision all serialize on this row.
  select * into version from public.video_versions vv where vv.id=set_version_artwork.version_id for update;
  if video.state not in ('draft','published') or video.latest_version_id is distinct from version_id or version.state<>'draft'
    or exists(select 1 from public.upload_reservations r where r.version_id=set_version_artwork.version_id)
    then raise exception 'Current unuploaded draft required' using errcode='22023'; end if;
  if not public.valid_version_artwork(image_data) then raise exception 'Invalid thumbnail' using errcode='22023'; end if;
  insert into public.version_artwork(version_id,image_data) values(set_version_artwork.version_id,set_version_artwork.image_data)
    on conflict on constraint version_artwork_pkey do update set image_data=excluded.image_data,updated_at=now();
end;
$$;

create or replace function public.set_creator_suspension(creator_id uuid,suspended boolean,reason text) returns void language plpgsql security definer set search_path='' as $$
declare incident_id uuid;
begin
  if not public.is_admin() then raise exception 'Administrator required' using errcode='42501'; end if;
  if creator_id is null or creator_id=auth.uid() then raise exception 'Other creator required' using errcode='42501'; end if;
  if suspended is null or reason is null or char_length(reason) not between 5 and 1000 then raise exception 'Invalid suspension decision' using errcode='22023'; end if;
  perform 1 from public.profiles where id=creator_id for update;
  if not exists(select 1 from public.profiles p where p.id=creator_id) then raise exception 'Account required' using errcode='22023'; end if;
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

create or replace function public.set_quota_override(creator_id uuid,daily_uploads integer,monthly_seconds integer,expires_at timestamptz,reason text) returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.is_admin() then raise exception 'Administrator required' using errcode='42501'; end if;
  if creator_id is null or creator_id=auth.uid() then raise exception 'Other creator required' using errcode='42501'; end if;
  if reason is null or char_length(reason) not between 5 and 1000 then raise exception 'Override reason required' using errcode='22023'; end if;
  perform 1 from public.profiles where id=creator_id for update;
  if not exists(select 1 from public.profiles p where p.id=creator_id) then raise exception 'Account required' using errcode='22023'; end if;
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

create or replace function public.begin_upload_grant(reservation_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare reservation public.upload_reservations; leased boolean:=false; video public.videos;
begin
  select * into reservation from public.upload_reservations where id=reservation_id;
  if not found then raise exception 'Reservation not found' using errcode='22023'; end if;
  perform 1 from public.profiles where id=reservation.owner_id for update;
  select v.* into video from public.videos v join public.video_versions vv on vv.video_id=v.id where vv.id=reservation.version_id for update of v;
  select * into reservation from public.upload_reservations where id=reservation_id for update;
  if reservation.state='reserved' and reservation.operation_state='not_started' and reservation.expires_at>now()
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
    where a.state='processing' and (a.poll_lease_until is null or a.poll_lease_until<=now())
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

-- Reassert unchanged public/worker execution boundaries after replacement.
revoke all on function public.create_video_version(uuid,jsonb),public.reserve_video_upload(uuid,text),public.can_edit_version_artwork(uuid),public.set_creator_suspension(uuid,boolean,text),public.set_quota_override(uuid,integer,integer,timestamptz,text),public.set_version_artwork(uuid,uuid,text),public.begin_upload_grant(uuid),public.bind_video_provider(uuid,text),public.claim_media_processing(integer) from public,anon,authenticated,service_role;
grant execute on function public.create_video_version(uuid,jsonb),public.reserve_video_upload(uuid,text),public.can_edit_version_artwork(uuid),public.set_creator_suspension(uuid,boolean,text),public.set_quota_override(uuid,integer,integer,timestamptz,text) to authenticated;
grant execute on function public.set_version_artwork(uuid,uuid,text),public.begin_upload_grant(uuid),public.bind_video_provider(uuid,text),public.claim_media_processing(integer) to service_role;
