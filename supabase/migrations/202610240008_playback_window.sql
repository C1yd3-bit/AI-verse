-- Local test policy proposal: verified duration plus one minute for startup,
-- bounded to five minutes. Live token revocation must still be measured before
-- release; this migration is not an approved public removal SLA.
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
  return jsonb_build_object('provider_uid',provider_uid,'version_id',selected_version_id,'expires_at',now()+make_interval(secs=>window_seconds));
end;
$$;
revoke all on function public.playback_entitlement(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.playback_entitlement(uuid,uuid,uuid) to service_role;
