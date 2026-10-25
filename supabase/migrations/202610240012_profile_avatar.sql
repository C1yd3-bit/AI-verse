-- Small private profile photos, independent of public creator/video projections.
-- Normalization belongs to the Node image decoder; SQL also bounds and validates
-- the canonical WebP envelope, including direct RPC calls outside the UI.
create function public.valid_avatar_data(photo_data text) returns boolean
language plpgsql immutable set search_path='' as $$
declare encoded text; image_bytes bytea;
begin
  if photo_data is null or octet_length(photo_data)>87407
    or left(photo_data,23)<>'data:image/webp;base64,' then return false; end if;
  encoded:=substring(photo_data from 24);
  if encoded !~ '^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$' then return false; end if;
  image_bytes:=decode(encoded,'base64');
  return octet_length(image_bytes) between 12 and 65536
    and substring(image_bytes from 1 for 4)=decode('52494646','hex')
    and substring(image_bytes from 9 for 4)=decode('57454250','hex')
    and replace(encode(image_bytes,'base64'),E'\n','')=encoded;
exception when others then return false;
end;
$$;
revoke all on function public.valid_avatar_data(text) from public,anon,authenticated;

create table public.account_avatars (
  user_id uuid primary key references auth.users(id) on delete cascade,
  photo_data text not null check(public.valid_avatar_data(photo_data)),
  updated_at timestamptz not null default now()
);
alter table public.account_avatars enable row level security;
create policy account_avatars_owner_read on public.account_avatars for select to authenticated
  using(user_id=(select auth.uid()) and (select public.has_verified_email()));
revoke all on public.account_avatars from public,anon,authenticated;
grant select on public.account_avatars to authenticated;

create function public.get_my_avatar() returns text language plpgsql stable security definer set search_path='' as $$
declare viewer uuid:=auth.uid(); result text;
begin
  if viewer is null or not public.has_verified_email() then raise exception 'Verified email required' using errcode='42501'; end if;
  select photo_data into result from public.account_avatars where user_id=viewer;
  return result;
end;
$$;
revoke all on function public.get_my_avatar() from public,anon,authenticated;
grant execute on function public.get_my_avatar() to authenticated;

create function public.set_my_avatar(photo_data text) returns void language plpgsql security definer set search_path='' as $$
declare viewer uuid:=auth.uid();
begin
  if viewer is null or not public.has_verified_email() then raise exception 'Verified email required' using errcode='42501'; end if;
  if not public.valid_avatar_data(photo_data) then raise exception 'Invalid profile photo' using errcode='22023'; end if;
  insert into public.account_avatars(user_id,photo_data) values(viewer,photo_data)
    on conflict(user_id) do update set photo_data=excluded.photo_data,updated_at=now();
end;
$$;
revoke all on function public.set_my_avatar(text) from public,anon,authenticated;
grant execute on function public.set_my_avatar(text) to authenticated;
