-- Browser RPC callers bypass HTTP Zod validation. Enforce the same queue-safe
-- JSON types and bounds in PostgreSQL before storing any application/version.
create function public.trim_media_text(value text) returns text language sql immutable set search_path='' as $$
  select btrim(value,E' \t\n\r\f'||chr(11)||chr(160)||chr(5760)||chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279));
$$;
-- Zod/JavaScript count UTF-16 units; PostgreSQL char_length counts Unicode code
-- points. An astral character must count twice to keep queue validation aligned.
create function public.media_text_length(value text) returns integer language sql immutable set search_path='' as $$
  select char_length(value)+char_length(regexp_replace(value,'['||chr(1)||'-'||chr(65535)||']','','g'));
$$;
create or replace function public.submit_creator_application(application jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare new_id uuid; normalized jsonb; field text;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if application is null or jsonb_typeof(application)<>'object' or octet_length(application::text)>8192 then raise exception 'Invalid application' using errcode='22023'; end if;
  if exists(select 1 from jsonb_object_keys(application) k where k not in ('display_name','handle','bio','portfolio_url','rights_attested')) then raise exception 'Invalid application fields' using errcode='22023'; end if;
  foreach field in array array['display_name','handle','bio','portfolio_url'] loop
    if jsonb_typeof(application->field) is distinct from 'string' then raise exception 'Application strings required' using errcode='22023'; end if;
  end loop;
  normalized:=application || jsonb_build_object('display_name',public.trim_media_text(application->>'display_name'),'bio',public.trim_media_text(application->>'bio'));
  if public.media_text_length(normalized->>'display_name') not between 1 and 80
    or normalized->>'handle' !~ '^[a-z0-9][a-z0-9_-]{2,29}$'
    or public.media_text_length(normalized->>'bio') not between 1 and 2000
    or public.media_text_length(normalized->>'portfolio_url') not between 9 and 2000
    or normalized->>'portfolio_url' !~ '^https://[^[:space:]/?#]+([/?#][^[:space:]]*)?$'
    or normalized->'rights_attested' is distinct from 'true'::jsonb then raise exception 'Invalid application' using errcode='22023'; end if;
  insert into public.creator_applications(user_id,application) values(auth.uid(),normalized) returning id into new_id;
  return new_id;
end;
$$;

create or replace function public.validate_video_metadata(metadata jsonb) returns void language plpgsql security definer set search_path='' as $$
declare field text; values_array text[];
begin
  if metadata is null or jsonb_typeof(metadata)<>'object' or octet_length(metadata::text)>16384 then raise exception 'Invalid metadata' using errcode='22023'; end if;
  if exists(select 1 from jsonb_object_keys(metadata) k where k not in ('title','description','format','genres','regions','languages','tags','ai_disclosed','rights_attested','rights_declaration')) then raise exception 'Invalid metadata fields' using errcode='22023'; end if;
  foreach field in array array['title','description','format','rights_declaration'] loop
    if jsonb_typeof(metadata->field) is distinct from 'string' then raise exception 'Metadata strings required' using errcode='22023'; end if;
  end loop;
  if public.media_text_length(public.trim_media_text(metadata->>'title')) not between 1 and 160
    or public.media_text_length(public.trim_media_text(metadata->>'description')) not between 1 and 3000
    or metadata->>'format' not in ('reel','movie')
    or metadata->'ai_disclosed' is distinct from 'true'::jsonb
    or metadata->'rights_attested' is distinct from 'true'::jsonb
    or public.media_text_length(public.trim_media_text(metadata->>'rights_declaration')) not between 20 and 1000 then raise exception 'Invalid metadata fields' using errcode='22023'; end if;
  -- Bound raw stored strings too: client forms trim on read, but queue schemas
  -- must never receive an unbounded whitespace-padded string from a direct RPC.
  if public.media_text_length(metadata->>'title')>160 or public.media_text_length(metadata->>'description')>3000 or public.media_text_length(metadata->>'rights_declaration')>1000 then raise exception 'Metadata strings too long' using errcode='22023'; end if;
  foreach field in array array['genres','regions','languages','tags'] loop
    if jsonb_typeof(metadata->field) is distinct from 'array' then raise exception 'Invalid metadata array' using errcode='22023'; end if;
    if exists(select 1 from jsonb_array_elements(metadata->field) item where jsonb_typeof(item)<>'string') then raise exception 'Expected string selections' using errcode='22023'; end if;
    select coalesce(array_agg(item),'{}'::text[]) into values_array from jsonb_array_elements_text(metadata->field) item;
    if cardinality(values_array)>12 or cardinality(values_array)<>(select count(distinct s) from unnest(values_array) s) then raise exception 'Invalid or duplicate selection' using errcode='22023'; end if;
    if field='genres' and (cardinality(values_array)<1 or exists(select 1 from unnest(values_array) s where not exists(select 1 from public.genres g where g.slug=s))) then raise exception 'Unknown genre' using errcode='22023'; end if;
    if field='regions' and (cardinality(values_array)<1 or exists(select 1 from unnest(values_array) s where not exists(select 1 from public.content_regions r where r.slug=s))) then raise exception 'Unknown content region' using errcode='22023'; end if;
    if field='languages' and (cardinality(values_array)<1 or exists(select 1 from unnest(values_array) s where not exists(select 1 from public.languages l where l.slug=s))) then raise exception 'Unknown language' using errcode='22023'; end if;
    if field='tags' and (cardinality(values_array)>10 or exists(select 1 from unnest(values_array) s where s !~ '^[a-z0-9][a-z0-9-]{0,39}$')) then raise exception 'Invalid tags' using errcode='22023'; end if;
  end loop;
end;
$$;

-- Role revocations, suspensions, quota reservations and grant binding serialize
-- on the same owner profile row. No client-editable profile role is introduced.
create or replace function public.set_user_role(target_user_id uuid, requested_role text, should_grant boolean, decision_reason text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.is_admin() then raise exception 'Administrator required' using errcode='42501'; end if;
  if requested_role is null or requested_role not in ('creator','moderator','admin') or should_grant is null
    or decision_reason is null or char_length(decision_reason) not between 5 and 1000 then raise exception 'Invalid role decision' using errcode='22023'; end if;
  if target_user_id=auth.uid() then raise exception 'Self role changes denied' using errcode='42501'; end if;
  perform 1 from public.profiles where id=target_user_id for update;
  if should_grant then insert into public.user_roles(user_id,role) values(target_user_id,requested_role) on conflict do nothing;
  else delete from public.user_roles where user_id=target_user_id and role=requested_role; end if;
  insert into public.role_audit(actor_id,target_id,role,granted,reason) values(auth.uid(),target_user_id,requested_role,should_grant,decision_reason);
end;
$$;

-- The external provider call is outside a database transaction. A lease that was
-- valid before that call may have been cancelled by the time its asset is bound.
-- Keep the asset identity durably even when it is no longer safe to return a URL.
drop function public.bind_video_provider(uuid,text);
create function public.bind_video_provider(reservation_id uuid,provider_uid text) returns jsonb language plpgsql security definer set search_path='' as $$
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
    and exists(select 1 from public.user_roles r where r.user_id=reservation.owner_id and r.role='creator');
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

revoke all on function public.trim_media_text(text),public.media_text_length(text),public.submit_creator_application(jsonb),public.validate_video_metadata(jsonb),public.set_user_role(uuid,text,boolean,text),public.bind_video_provider(uuid,text) from public,anon,authenticated;
grant execute on function public.submit_creator_application(jsonb),public.set_user_role(uuid,text,boolean,text) to authenticated;
grant execute on function public.bind_video_provider(uuid,text) to service_role;
