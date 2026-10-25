-- Optional normalized artwork belongs to the exact reviewed version, never the video.
-- Only the server decoder may write bytes; users cannot bypass normalization by RPC.
create function public.valid_version_artwork(image_data text) returns boolean
language plpgsql immutable set search_path='' as $$
declare encoded text; image_bytes bytea;
begin
  if image_data is null or octet_length(image_data)>349550
    or left(image_data,23)<>'data:image/webp;base64,' then return false; end if;
  encoded:=substring(image_data from 24);
  if encoded !~ '^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$' then return false; end if;
  image_bytes:=decode(encoded,'base64');
  return octet_length(image_bytes) between 12 and 262144
    and substring(image_bytes from 1 for 4)=decode('52494646','hex')
    and substring(image_bytes from 9 for 4)=decode('57454250','hex')
    and replace(encode(image_bytes,'base64'),E'\n','')=encoded;
exception when others then return false;
end;
$$;
revoke all on function public.valid_version_artwork(text) from public,anon,authenticated,service_role;

create table public.version_artwork (
  version_id uuid primary key references public.video_versions(id) on delete cascade,
  image_data text not null check(public.valid_version_artwork(image_data)),
  updated_at timestamptz not null default now()
);
alter table public.version_artwork enable row level security;
revoke all on public.version_artwork from public,anon,authenticated,service_role;

create function public.set_version_artwork(target_account uuid,version_id uuid,image_data text) returns void
language plpgsql security definer set search_path='' as $$
declare video public.videos; version public.video_versions;
begin
  -- target_account is supplied solely by the verified server session, never input JSON.
  if target_account is null then raise exception 'Verified creator required' using errcode='42501'; end if;
  perform 1 from public.profiles where id=target_account for update;
  if not exists(select 1 from auth.users u where u.id=target_account and u.email_confirmed_at is not null)
    or not exists(select 1 from public.user_roles r where r.user_id=target_account and r.role='creator')
    or public.creator_is_suspended(target_account) then raise exception 'Verified creator required' using errcode='42501'; end if;
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
revoke all on function public.set_version_artwork(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.set_version_artwork(uuid,uuid,text) to service_role;

-- Cheap authenticated preflight before spending image decoder work. The write
-- repeats these checks under locks, so this boolean is never write authority.
create function public.can_edit_version_artwork(version_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and public.has_verified_email() and public.is_creator()
    and exists(select 1 from public.video_versions vv join public.videos v on v.id=vv.video_id
      where vv.id=$1 and v.owner_id=auth.uid() and v.latest_version_id=vv.id
        and v.state in ('draft','published') and vv.state='draft'
        and not exists(select 1 from public.upload_reservations r where r.version_id=vv.id));
$$;
revoke all on function public.can_edit_version_artwork(uuid) from public,anon,authenticated,service_role;
grant execute on function public.can_edit_version_artwork(uuid) to authenticated;

create function public.get_version_artwork(version_id uuid) returns text
language plpgsql stable security definer set search_path='' as $$
declare owner uuid; result text;
begin
  if auth.uid() is null or not public.has_verified_email() then raise exception 'Verified account required' using errcode='42501'; end if;
  select v.owner_id into owner from public.video_versions vv join public.videos v on v.id=vv.video_id where vv.id=version_id;
  if owner is null or (owner<>auth.uid() and not public.can_review_media()) then raise exception 'Private version unavailable' using errcode='42501'; end if;
  select a.image_data into result from public.version_artwork a where a.version_id=get_version_artwork.version_id;
  return result;
end;
$$;
revoke all on function public.get_version_artwork(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_version_artwork(uuid) to authenticated;

create function public.get_public_version_artwork(version_id uuid) returns text
language sql stable security definer set search_path='' as $$
  select a.image_data from public.version_artwork a
    join public.video_versions vv on vv.id=a.version_id
    join public.videos v on v.id=vv.video_id and v.active_version_id=vv.id
    where vv.id=$1 and vv.state='published' and v.state='published'
      and not public.creator_is_suspended(v.owner_id);
$$;
revoke all on function public.get_public_version_artwork(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_public_version_artwork(uuid) to anon,authenticated;

create or replace view public.public_catalog with (security_barrier=true) as
  select v.id,vv.id as version_id,v.owner_id as creator_id,
    vv.metadata->>'title' as title,vv.metadata->>'description' as description,vv.metadata->>'format' as format,
    vv.metadata->'genres' as genres,vv.metadata->'regions' as regions,
    (select jsonb_agg(vl.language_slug order by vl.language_slug) from public.video_languages vl where vl.version_id=vv.id) as languages,
    vv.metadata->'tags' as tags,true as ai_disclosed,v.published_at,vv.duration_seconds,
    exists(select 1 from public.version_artwork a where a.version_id=vv.id) as has_artwork
  from public.videos v join public.video_versions vv on vv.id=v.active_version_id
  where v.state='published' and vv.state='published' and not public.creator_is_suspended(v.owner_id);
revoke all on public.public_catalog from public,anon,authenticated;
grant select on public.public_catalog to anon,authenticated;
