-- Foundation only. Apply with Supabase migrations; no service-role browser access.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 80),
  created_at timestamptz not null default now()
);
create table public.user_roles (
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('viewer','creator','moderator','admin')),
  primary key (user_id, role)
);
create table public.role_audit (
  id bigint generated always as identity primary key,
  actor_id uuid not null references auth.users(id),
  target_id uuid not null references auth.users(id),
  role text not null,
  granted boolean not null,
  reason text not null check (char_length(reason) between 5 and 1000),
  created_at timestamptz not null default now()
);
create table public.genres (
  slug text primary key check (slug ~ '^[a-z][a-z0-9-]{0,39}$'),
  label text not null check (char_length(label) between 1 and 80)
);
create table public.content_regions (
  slug text primary key check (slug ~ '^[a-z][a-z0-9-]{0,39}$'),
  label text not null check (char_length(label) between 1 and 80)
);
create table public.viewer_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null check (status in ('completed', 'skipped')),
  genres text[] not null default '{}',
  regions text[] not null default '{}',
  updated_at timestamptz not null default now(),
  check ((status = 'completed' and cardinality(genres) between 5 and 8 and cardinality(regions) <= 12)
    or (status = 'skipped' and cardinality(genres) = 0 and cardinality(regions) = 0))
);

create function public.is_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.user_roles where user_id = auth.uid() and role = 'admin');
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.role_audit enable row level security;
alter table public.genres enable row level security;
alter table public.content_regions enable row level security;
alter table public.viewer_preferences enable row level security;

create policy profiles_read_own on public.profiles for select to authenticated using (id = auth.uid());
create policy profiles_update_own on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy roles_read_own_or_admin on public.user_roles for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy audit_read_admin on public.role_audit for select to authenticated using (public.is_admin());
create policy genres_public_read on public.genres for select to anon, authenticated using (true);
create policy regions_public_read on public.content_regions for select to anon, authenticated using (true);
create policy preferences_read_own on public.viewer_preferences for select to authenticated using (user_id = auth.uid());

-- Supabase default grants may otherwise permit mutations. Writes are narrowly granted.
revoke all on public.profiles, public.user_roles, public.role_audit, public.genres, public.content_regions, public.viewer_preferences from anon, authenticated;
grant select on public.genres, public.content_regions to anon, authenticated;
grant select on public.profiles, public.user_roles, public.role_audit, public.viewer_preferences to authenticated;
grant update(display_name) on public.profiles to authenticated;

create function public.initialize_viewer() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Never accept roles or privileges from signup metadata.
  insert into public.profiles(id) values(new.id);
  insert into public.user_roles(user_id,role) values(new.id,'viewer');
  return new;
end;
$$;
revoke all on function public.initialize_viewer() from public, anon, authenticated;
create trigger initialize_viewer after insert on auth.users for each row execute function public.initialize_viewer();

create function public.save_viewer_preferences(preference_status text, genre_slugs text[], region_slugs text[])
returns void language plpgsql security definer set search_path = '' as $$
declare viewer_id uuid := auth.uid();
begin
  if viewer_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if preference_status is null or genre_slugs is null or region_slugs is null then raise exception 'Invalid preferences' using errcode = '22023'; end if;
  if preference_status not in ('completed', 'skipped') then raise exception 'Invalid status' using errcode = '22023'; end if;
  if preference_status = 'skipped' and (cardinality(genre_slugs) <> 0 or cardinality(region_slugs) <> 0) then raise exception 'Skip requires empty selections' using errcode = '22023'; end if;
  if preference_status = 'completed' and cardinality(genre_slugs) not between 5 and 8 then raise exception 'Choose 5 to 8 genres' using errcode = '22023'; end if;
  if cardinality(region_slugs) > 12 then raise exception 'Too many regions' using errcode = '22023'; end if;
  if cardinality(genre_slugs) <> (select count(distinct s) from unnest(genre_slugs) s)
    or cardinality(region_slugs) <> (select count(distinct s) from unnest(region_slugs) s) then raise exception 'Duplicate or null selection' using errcode = '22023'; end if;
  if (select count(*) from public.genres where slug = any(genre_slugs)) <> cardinality(genre_slugs)
    or (select count(*) from public.content_regions where slug = any(region_slugs)) <> cardinality(region_slugs) then raise exception 'Unknown taxonomy selection' using errcode = '22023'; end if;
  insert into public.viewer_preferences(user_id,status,genres,regions,updated_at)
    values(viewer_id,preference_status,genre_slugs,region_slugs,now())
    on conflict(user_id) do update set status=excluded.status,genres=excluded.genres,regions=excluded.regions,updated_at=excluded.updated_at;
end;
$$;
revoke all on function public.save_viewer_preferences(text,text[],text[]) from public, anon;
grant execute on function public.save_viewer_preferences(text,text[],text[]) to authenticated;

create function public.set_user_role(target_user_id uuid, requested_role text, should_grant boolean, decision_reason text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Administrator required' using errcode = '42501'; end if;
  if requested_role is null or requested_role not in ('creator','moderator','admin') or should_grant is null
    or decision_reason is null or char_length(decision_reason) not between 5 and 1000 then raise exception 'Invalid role decision' using errcode = '22023'; end if;
  if target_user_id = auth.uid() then raise exception 'Self role changes denied' using errcode = '42501'; end if;
  if should_grant then insert into public.user_roles(user_id, role) values(target_user_id, requested_role) on conflict do nothing;
  else delete from public.user_roles where user_id = target_user_id and role = requested_role; end if;
  insert into public.role_audit(actor_id,target_id,role,granted,reason) values(auth.uid(), target_user_id, requested_role, should_grant, decision_reason);
end;
$$;
revoke all on function public.set_user_role(uuid,text,boolean,text) from public, anon;
grant execute on function public.set_user_role(uuid,text,boolean,text) to authenticated;

-- Backfill existing auth accounts when applying to a provisioned project.
insert into public.profiles(id) select id from auth.users on conflict do nothing;
insert into public.user_roles(user_id,role) select id,'viewer' from auth.users on conflict do nothing;
