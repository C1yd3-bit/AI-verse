-- Supabase signed upload PUT capabilities last two hours. A user may mint one
-- immediately before the ingress reservation expires. Removing an object sooner
-- would allow its still-valid capability to recreate an untracked private file.
-- Quarantine/visibility invalidation stays immediate; physical removal waits for
-- the full capability window plus a five-minute clock/race margin.
create or replace function public.claim_storage_deletions(batch_size integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare candidate record; upload public.storage_media_uploads; reservation public.upload_reservations;
  video public.videos; version public.video_versions; jobs jsonb;
begin
  if batch_size is null or batch_size not between 1 and 3 then raise exception 'Cleanup batch must be one to three' using errcode='22023'; end if;
  -- Parent-first SKIP LOCKED acquisition matches completion/failure and avoids
  -- taking ledger locks while another transaction owns its profile/video.
  for candidate in
    select s.reservation_id,s.owner_id,s.version_id from public.storage_media_uploads s
    join public.upload_reservations r on r.id=s.reservation_id
    join public.video_versions vv on vv.id=s.version_id join public.videos v on v.id=vv.video_id
    where (s.state='failed' and not exists(select 1 from public.private_media_assets a join public.media_deletion_jobs j on j.asset_id=a.id where a.reservation_id=s.reservation_id))
      or (s.state='reserved' and (r.expires_at<=now() or r.state in ('expired','cancelled')
        or vv.state in ('failed','rejected','removed') or v.state in ('hidden','removed')))
    order by s.created_at,s.reservation_id limit batch_size
  loop
    perform 1 from public.profiles p where p.id=candidate.owner_id for update skip locked;
    if not found then continue; end if;
    select v.* into video from public.videos v join public.video_versions vv on vv.video_id=v.id where vv.id=candidate.version_id for update of v skip locked;
    if not found then continue; end if;
    select * into reservation from public.upload_reservations r where r.id=candidate.reservation_id for update skip locked;
    if not found then continue; end if;
    select * into upload from public.storage_media_uploads s where s.reservation_id=candidate.reservation_id for update skip locked;
    if not found then continue; end if;
    select * into version from public.video_versions vv where vv.id=upload.version_id;
    if upload.state='failed' or (upload.state='reserved' and (reservation.expires_at<=now()
      or reservation.state in ('expired','cancelled') or version.state in ('failed','rejected','removed') or video.state in ('hidden','removed'))) then
      -- No completed ready/pending-review object is expired by its old ingress
      -- deadline. Legitimate published/current preview data stays untouched.
      update public.storage_media_uploads set state='failed' where reservation_id=upload.reservation_id;
      update public.upload_reservations set state='expired',operation_state='failed' where id=reservation.id and state in ('reserved','bound');
      update public.video_versions set state='failed' where id=version.id and state in ('uploading','processing');
      perform public.queue_storage_upload_cleanup(upload.reservation_id);
    end if;
  end loop;
  with exhausted as (
    select j.id from public.media_deletion_jobs j
    join public.private_media_assets a on a.id=j.asset_id
    join public.storage_media_uploads s on s.reservation_id=a.reservation_id
    where a.provider_uid='supabase:'||s.reservation_id::text and j.attempts>=10
      and j.state in ('pending','retry','processing') and (j.lease_until is null or j.lease_until<=now())
    order by j.next_attempt_at,j.id limit batch_size for update of j skip locked
  ) update public.media_deletion_jobs j set state='exhausted' from exhausted e where j.id=e.id;
  with candidates as (
    select j.id from public.media_deletion_jobs j
    join public.private_media_assets a on a.id=j.asset_id
    join public.storage_media_uploads s on s.reservation_id=a.reservation_id
    join public.upload_reservations r on r.id=s.reservation_id
    where a.provider_uid='supabase:'||s.reservation_id::text and a.state='deleting' and j.attempts<10
      and r.expires_at+interval '2 hours 5 minutes'<=now()
      and ((j.state in ('pending','retry') and j.next_attempt_at<=now()) or (j.state='processing' and j.lease_until<=now()))
    order by j.next_attempt_at,j.id limit batch_size for update of j,r,a skip locked
  ), claimed as (
    update public.media_deletion_jobs j set state='processing',attempts=j.attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes'
      from candidates c where j.id=c.id returning j.*
  ) select coalesce(jsonb_agg(jsonb_build_object('job_id',c.id,'lease_token',c.lease_token,'bucket',s.bucket,
      'object_path',s.object_path,'attempts',c.attempts) order by c.id),'[]'::jsonb)
    into jobs from claimed c join public.private_media_assets a on a.id=c.asset_id
      join public.storage_media_uploads s on s.reservation_id=a.reservation_id;
  return jobs;
end;
$$;
revoke all on function public.claim_storage_deletions(integer) from public,anon,authenticated,service_role;
grant execute on function public.claim_storage_deletions(integer) to service_role;
