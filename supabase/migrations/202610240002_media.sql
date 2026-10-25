-- Proposed UTC quotas are local MVP defaults, not an approved production policy.
create table public.creator_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  application jsonb not null,
  status text not null default 'pending' check(status in ('pending','approved','rejected')),
  decision_reason text,
  decided_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create unique index one_pending_creator_application on public.creator_applications(user_id) where status='pending';
create table public.media_audit (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id),
  action text not null,
  subject_id uuid not null,
  reason text not null,
  created_at timestamptz not null default now()
);
create table public.languages(slug text primary key, label text not null);
insert into public.languages values ('english','English'),('korean','Korean'),('mandarin','Mandarin'),('cantonese','Cantonese'),('tagalog','Tagalog'),('japanese','Japanese'),('hindi','Hindi'),('thai','Thai'),('vietnamese','Vietnamese'),('turkish','Turkish'),('spanish','Spanish'),('french','French'),('german','German'),('portuguese','Portuguese'),('arabic','Arabic'),('indonesian','Indonesian'),('silent','No dialogue');
create table public.videos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  state text not null default 'draft' check(state in ('draft','published','hidden','removed')),
  latest_version_id uuid,
  active_version_id uuid,
  created_at timestamptz not null default now(),
  published_at timestamptz
);
create table public.video_versions (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos(id),
  revision integer not null,
  metadata jsonb not null,
  state text not null default 'draft' check(state in ('draft','uploading','processing','pending_review','published','rejected','failed','removed')),
  duration_seconds integer,
  created_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  unique(video_id,revision)
);
alter table public.videos add foreign key(latest_version_id) references public.video_versions(id);
alter table public.videos add foreign key(active_version_id) references public.video_versions(id);
create table public.video_languages (
  version_id uuid not null references public.video_versions(id),
  language_slug text not null references public.languages(slug),
  primary key(version_id,language_slug)
);
create table public.video_review_notes (
  version_id uuid primary key references public.video_versions(id),
  reviewer_id uuid not null references auth.users(id),
  reason text not null,
  approved boolean not null,
  created_at timestamptz not null default now()
);
create table public.upload_reservations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  version_id uuid not null unique references public.video_versions(id),
  idempotency_key text not null check(char_length(idempotency_key) between 8 and 100),
  state text not null default 'reserved' check(state in ('reserved','bound','consumed','expired','cancelled')),
  operation_state text not null default 'not_started' check(operation_state in ('not_started','granting','bound','uncertain','failed')),
  reserved_seconds integer not null default 180 check(reserved_seconds between 1 and 1800),
  consumed_seconds integer,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '15 minutes',
  unique(owner_id,idempotency_key)
);
create index upload_reservations_quota on public.upload_reservations(owner_id,created_at,state);
create table public.private_media_assets (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null unique references public.upload_reservations(id),
  provider_uid text not null unique check(char_length(provider_uid) between 1 and 256),
  state text not null default 'processing' check(state in ('processing','ready','failed','deleting','deleted')),
  last_error text,
  created_at timestamptz not null default now()
);
create table public.provider_events (
  event_key text primary key check(char_length(event_key) between 1 and 256),
  provider_uid text not null,
  provider_state text not null,
  duration_seconds integer,
  created_at timestamptz not null default now()
);
create table public.upload_operations (
  reservation_id uuid primary key references public.upload_reservations(id),
  started_at timestamptz not null default now(),
  last_error text,
  updated_at timestamptz not null default now()
);
create table public.media_deletion_jobs (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null unique references public.private_media_assets(id),
  state text not null default 'pending' check(state in ('pending','processing','retry','completed','exhausted')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  lease_until timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

-- Trust slice replaces these stable hooks with persisted suspension and audited
-- override policy. Baselines keep this migration independently executable.
create function public.creator_is_suspended(target uuid) returns boolean language sql stable security definer set search_path='' as $$ select false; $$;
create function public.get_upload_limits(target uuid) returns jsonb language sql stable security definer set search_path='' as $$
  select '{"daily_uploads":3,"monthly_seconds":1800,"max_duration_seconds":180}'::jsonb;
$$;
revoke all on function public.creator_is_suspended(uuid),public.get_upload_limits(uuid) from public,anon,authenticated;
grant execute on function public.creator_is_suspended(uuid) to anon,authenticated,service_role;
grant execute on function public.get_upload_limits(uuid) to service_role;
create function public.can_review_media() returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.user_roles where user_id=auth.uid() and role in ('admin','moderator'));
$$;
create function public.is_creator() returns boolean language sql stable security definer set search_path='' as $$
  select not public.creator_is_suspended(auth.uid()) and exists(select 1 from public.user_roles where user_id=auth.uid() and role='creator');
$$;
revoke all on function public.can_review_media(), public.is_creator() from public, anon;
grant execute on function public.can_review_media(), public.is_creator() to authenticated;

alter table public.creator_applications enable row level security;
alter table public.media_audit enable row level security;
alter table public.languages enable row level security;
alter table public.videos enable row level security;
alter table public.video_versions enable row level security;
alter table public.video_languages enable row level security;
alter table public.video_review_notes enable row level security;
alter table public.upload_reservations enable row level security;
alter table public.private_media_assets enable row level security;
alter table public.provider_events enable row level security;
alter table public.upload_operations enable row level security;
alter table public.media_deletion_jobs enable row level security;
create policy creator_application_read on public.creator_applications for select to authenticated using(user_id=auth.uid() or public.is_admin());
create policy media_audit_read on public.media_audit for select to authenticated using(public.can_review_media());
create policy languages_read on public.languages for select to anon,authenticated using(true);
create policy videos_private_read on public.videos for select to authenticated using(owner_id=auth.uid() or public.can_review_media());
create policy versions_private_read on public.video_versions for select to authenticated using(exists(select 1 from public.videos where id=video_id and (owner_id=auth.uid() or public.can_review_media())));
create policy version_languages_read on public.video_languages for select to authenticated using(exists(select 1 from public.video_versions where id=version_id));
create policy review_notes_read on public.video_review_notes for select to authenticated using(public.can_review_media());
create policy reservations_owner_read on public.upload_reservations for select to authenticated using(owner_id=auth.uid() or public.can_review_media());
revoke all on public.creator_applications,public.media_audit,public.languages,public.videos,public.video_versions,public.video_languages,public.video_review_notes,public.upload_reservations,public.private_media_assets,public.provider_events,public.upload_operations,public.media_deletion_jobs from anon,authenticated;
grant select on public.creator_applications,public.media_audit,public.videos,public.video_versions,public.video_languages,public.video_review_notes,public.upload_reservations to authenticated;
grant select on public.languages to anon,authenticated;

create function public.submit_creator_application(application jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare new_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if application is null or jsonb_typeof(application)<>'object' or octet_length(application::text)>8192
    or exists(select 1 from jsonb_object_keys(application) k where k not in ('display_name','handle','bio','portfolio_url','rights_attested'))
    or coalesce(char_length(application->>'display_name'),0) not between 1 and 80
    or coalesce(application->>'handle','') !~ '^[a-z0-9][a-z0-9_-]{2,29}$'
    or coalesce(char_length(application->>'bio'),0) not between 1 and 2000
    or coalesce(application->>'portfolio_url','') !~ '^https://[^[:space:]]+$'
    or application->'rights_attested' is distinct from 'true'::jsonb then raise exception 'Invalid application' using errcode='22023'; end if;
  insert into public.creator_applications(user_id,application) values(auth.uid(),application) returning id into new_id;
  return new_id;
end;
$$;
create function public.decide_creator_application(application_id uuid, approve boolean, reason text) returns void language plpgsql security definer set search_path='' as $$
declare app public.creator_applications;
begin
  if not public.is_admin() then raise exception 'Administrator required' using errcode='42501'; end if;
  if approve is null or reason is null or char_length(reason) not between 5 and 1000 then raise exception 'Decision reason required' using errcode='22023'; end if;
  select * into app from public.creator_applications where id=application_id for update;
  if not found or app.status<>'pending' then raise exception 'Pending application not found' using errcode='22023'; end if;
  if app.user_id=auth.uid() then raise exception 'Self approval denied' using errcode='42501'; end if;
  update public.creator_applications set status=case when approve then 'approved' else 'rejected' end,decision_reason=reason,decided_by=auth.uid(),decided_at=now() where id=application_id;
  if approve then perform public.set_user_role(app.user_id,'creator',true,reason); end if;
  insert into public.media_audit(actor_id,action,subject_id,reason) values(auth.uid(),case when approve then 'creator_approved' else 'creator_rejected' end,application_id,reason);
end;
$$;

create function public.validate_video_metadata(metadata jsonb) returns void language plpgsql security definer set search_path='' as $$
declare field text; values_array text[];
begin
  if metadata is null or jsonb_typeof(metadata)<>'object' or octet_length(metadata::text)>16000 then raise exception 'Invalid metadata' using errcode='22023'; end if;
  if exists(select 1 from jsonb_object_keys(metadata) k where k not in ('title','description','format','genres','regions','languages','tags','ai_disclosed','rights_attested','rights_declaration'))
    or jsonb_typeof(metadata->'title') is distinct from 'string' or char_length(metadata->>'title') not between 1 and 160
    or jsonb_typeof(metadata->'description') is distinct from 'string' or char_length(metadata->>'description')>4000
    or coalesce(metadata->>'format','') not in ('reel','movie')
    or metadata->'ai_disclosed' is distinct from 'true'::jsonb or metadata->'rights_attested' is distinct from 'true'::jsonb
    or jsonb_typeof(metadata->'rights_declaration') is distinct from 'string' or char_length(metadata->>'rights_declaration') not between 5 and 1000
    then raise exception 'Invalid metadata fields' using errcode='22023'; end if;
  foreach field in array array['genres','regions','languages','tags'] loop
    if jsonb_typeof(metadata->field) is distinct from 'array' then raise exception 'Invalid metadata array' using errcode='22023'; end if;
    if exists(select 1 from jsonb_array_elements(metadata->field) item where jsonb_typeof(item)<>'string') then raise exception 'Expected string selections' using errcode='22023'; end if;
    select coalesce(array_agg(item),'{}'::text[]) into values_array from jsonb_array_elements_text(metadata->field) item;
    if cardinality(values_array)>12 or cardinality(values_array)<>(select count(distinct s) from unnest(values_array) s) then raise exception 'Invalid or duplicate selection' using errcode='22023'; end if;
    if field='genres' and (cardinality(values_array)<1 or exists(select 1 from unnest(values_array) s where not exists(select 1 from public.genres g where g.slug=s))) then raise exception 'Unknown genre' using errcode='22023'; end if;
    if field='regions' and exists(select 1 from unnest(values_array) s where not exists(select 1 from public.content_regions r where r.slug=s)) then raise exception 'Unknown content region' using errcode='22023'; end if;
    if field='languages' and (cardinality(values_array)<1 or exists(select 1 from unnest(values_array) s where not exists(select 1 from public.languages l where l.slug=s))) then raise exception 'Unknown language' using errcode='22023'; end if;
    if field='tags' and (cardinality(values_array)>10 or exists(select 1 from unnest(values_array) s where s !~ '^[a-z0-9][a-z0-9-]{0,39}$')) then raise exception 'Invalid tags' using errcode='22023'; end if;
  end loop;
end;
$$;
create function public.immutable_version_metadata() returns trigger language plpgsql set search_path='' as $$
begin
  if new.metadata is distinct from old.metadata or new.video_id<>old.video_id or new.revision<>old.revision or new.id<>old.id then raise exception 'Version metadata is immutable' using errcode='42501'; end if;
  return new;
end;
$$;
create trigger immutable_version_metadata before update on public.video_versions for each row execute function public.immutable_version_metadata();
create function public.create_video_version(video_id uuid,metadata jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare target public.videos; version_id uuid; revision_number integer;
begin
  if auth.uid() is null or not public.is_creator() then raise exception 'Approved creator required' using errcode='42501'; end if;
  perform 1 from public.profiles where id=auth.uid() for update;
  if not public.is_creator() then raise exception 'Approved creator required' using errcode='42501'; end if;
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

-- Private helper; callers below already hold the video/reservation lock as needed.
create function public.queue_media_deletion(asset_id uuid) returns void language sql security definer set search_path='' as $$
  insert into public.media_deletion_jobs(asset_id) values(asset_id) on conflict(asset_id) do nothing;
$$;
create function public.expire_upload_reservations() returns integer language plpgsql security definer set search_path='' as $$
declare reservation public.upload_reservations; asset uuid; count_expired integer:=0;
begin
  for reservation in select * from public.upload_reservations where state in ('reserved','bound') and expires_at<=now() for update skip locked loop
    update public.upload_reservations set state='expired' where id=reservation.id;
    update public.video_versions set state='failed' where id=reservation.version_id and state in ('uploading','processing');
    select id into asset from public.private_media_assets where reservation_id=reservation.id;
    if asset is not null then perform public.queue_media_deletion(asset); end if;
    count_expired:=count_expired+1;
  end loop;
  return count_expired;
end;
$$;
create function public.reserve_video_upload(version_id uuid,idempotency_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare video public.videos; version public.video_versions; reservation public.upload_reservations; used_seconds bigint; uploads bigint; limits jsonb; max_seconds integer;
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
    -- Expired holds do not consume entitlement; their provider assets are queued by expiry/reconciliation.
    select count(*) into uploads from public.upload_reservations r where r.owner_id=auth.uid() and r.created_at >= date_trunc('day',now() at time zone 'UTC') at time zone 'UTC' and (r.state='consumed' or (r.state in ('reserved','bound') and r.expires_at>now()));
    select coalesce(sum(case when r.state='consumed' then r.consumed_seconds else r.reserved_seconds end),0) into used_seconds from public.upload_reservations r where r.owner_id=auth.uid() and r.created_at >= date_trunc('month',now() at time zone 'UTC') at time zone 'UTC' and (r.state='consumed' or (r.state in ('reserved','bound') and r.expires_at>now()));
    if uploads>=(limits->>'daily_uploads')::integer or used_seconds+max_seconds>(limits->>'monthly_seconds')::integer then raise exception 'Upload quota exceeded' using errcode='22023'; end if;
    insert into public.upload_reservations(owner_id,version_id,idempotency_key,reserved_seconds) values(auth.uid(),version_id,idempotency_key,max_seconds) returning * into reservation;
    update public.video_versions set state='uploading' where id=version_id;
  end if;
  -- Browser-callable RPC never returns the private provider identifier. The internal
  -- grant lease provides it to the trusted server when recovering an operation.
  return jsonb_build_object('reservation_id',reservation.id,'version_id',reservation.version_id,'expires_at',reservation.expires_at,'max_duration_seconds',reservation.reserved_seconds,'state',reservation.state,'operation_state',reservation.operation_state,'provider_uid',null);
end;
$$;

create function public.begin_upload_grant(reservation_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
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
    and exists(select 1 from public.user_roles where user_id=reservation.owner_id and role='creator') then
    update public.upload_reservations set operation_state='granting' where id=reservation_id;
    insert into public.upload_operations(reservation_id) values(reservation_id);
    leased:=true; reservation.operation_state:='granting';
  end if;
  return jsonb_build_object('lease',leased,'reservation_id',reservation.id,'operation_key',reservation.id,'operation_state',reservation.operation_state,'provider_uid',(select provider_uid from public.private_media_assets where private_media_assets.reservation_id=reservation.id));
end;
$$;
create function public.mark_upload_grant_failure(reservation_id uuid,known_no_asset boolean,error_message text) returns void language plpgsql security definer set search_path='' as $$
begin
  update public.upload_reservations set operation_state=case when known_no_asset then 'failed' else 'uncertain' end,
    state=case when known_no_asset then 'cancelled' else state end
    where id=reservation_id and operation_state='granting';
  update public.upload_operations set last_error=left(error_message,1000),updated_at=now() where upload_operations.reservation_id=mark_upload_grant_failure.reservation_id;
end;
$$;
create function public.bind_video_provider(reservation_id uuid,provider_uid text) returns void language plpgsql security definer set search_path='' as $$
declare reservation public.upload_reservations; existing public.private_media_assets; asset_id uuid; video_state text;
begin
  if provider_uid is null or char_length(provider_uid) not between 1 and 256 then raise exception 'Invalid provider ID' using errcode='22023'; end if;
  select * into reservation from public.upload_reservations where id=reservation_id;
  if not found then raise exception 'Reservation not found' using errcode='22023'; end if;
  -- Same parent-first lock order as review/removal/reconciliation; a newly bound
  -- asset cannot slip between a takedown's state change and deletion-job scan.
  perform 1 from public.videos v join public.video_versions vv on vv.video_id=v.id where vv.id=reservation.version_id for update of v;
  select * into reservation from public.upload_reservations where id=reservation_id for update;
  if not found then raise exception 'Reservation not found' using errcode='22023'; end if;
  select * into existing from public.private_media_assets where private_media_assets.reservation_id=bind_video_provider.reservation_id;
  if found then
    if existing.provider_uid<>bind_video_provider.provider_uid then raise exception 'Provider binding conflict' using errcode='22023'; end if;
    return;
  end if;
  insert into public.private_media_assets(reservation_id,provider_uid) values(reservation_id,provider_uid) returning id into asset_id;
  select v.state into video_state from public.videos v join public.video_versions vv on vv.video_id=v.id where vv.id=reservation.version_id;
  if reservation.expires_at<=now() or reservation.state in ('expired','cancelled') or video_state in ('hidden','removed') or public.creator_is_suspended(reservation.owner_id) then
    update public.upload_reservations set state='expired',operation_state='bound' where id=reservation_id;
    perform public.queue_media_deletion(asset_id);
  else
    update public.upload_reservations set state='bound',operation_state='bound' where id=reservation_id;
    update public.video_versions set state='processing' where id=reservation.version_id and state='uploading';
  end if;
end;
$$;
create function public.reconcile_video_provider(event_key text,provider_uid text,provider_state text,actual_duration_seconds integer,operation_key uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
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
  select * into reservation from public.upload_reservations where id=asset.reservation_id;
  select * into version from public.video_versions where id=reservation.version_id;
  select * into video from public.videos where id=version.video_id for update;
  select * into reservation from public.upload_reservations where id=asset.reservation_id for update;
  insert into public.provider_events(event_key,provider_uid,provider_state,duration_seconds) values(event_key,provider_uid,provider_state,actual_duration_seconds);
  if video.state in ('removed','hidden') or public.creator_is_suspended(video.owner_id) or version.state in ('removed','failed','rejected') or reservation.state in ('expired','cancelled') or (reservation.state<>'consumed' and reservation.expires_at<=now()) then
    if reservation.state<>'consumed' then update public.upload_reservations set state='expired' where id=reservation.id; end if;
    perform public.queue_media_deletion(asset.id);
    return jsonb_build_object('ignored',true,'reason','unavailable_or_expired');
  end if;
  -- First terminal processing result wins. Later readiness/failure cannot change reviewed content.
  if reservation.state='consumed' then return jsonb_build_object('ignored',true,'reason','already_reconciled'); end if;
  if provider_state='ready' and actual_duration_seconds between 1 and reservation.reserved_seconds then
    update public.private_media_assets set state='ready' where id=asset.id;
    update public.upload_reservations set state='consumed',consumed_seconds=actual_duration_seconds where id=reservation.id;
    update public.video_versions set state='pending_review',duration_seconds=actual_duration_seconds where id=version.id;
    return jsonb_build_object('state','pending_review');
  end if;
  update public.private_media_assets set state='failed' where id=asset.id;
  -- Failed or oversized media consumes its full reservation under the provisional policy.
  update public.upload_reservations set state='consumed',consumed_seconds=reservation.reserved_seconds where id=reservation.id;
  update public.video_versions set state='failed' where id=version.id;
  perform public.queue_media_deletion(asset.id);
  return jsonb_build_object('state','failed');
end;
$$;

create function public.review_video_version(version_id uuid,approve boolean,reason text) returns void language plpgsql security definer set search_path='' as $$
declare version public.video_versions; video public.videos;
begin
  if not public.can_review_media() then raise exception 'Moderator required' using errcode='42501'; end if;
  if approve is null or reason is null or char_length(reason) not between 5 and 1000 then raise exception 'Review reason required' using errcode='22023'; end if;
  select * into version from public.video_versions where id=version_id;
  select * into video from public.videos where id=version.video_id for update;
  if video.id is null or video.state in ('hidden','removed') or public.creator_is_suspended(video.owner_id) or video.latest_version_id<>version_id or version.state<>'pending_review' then raise exception 'Current pending version required' using errcode='22023'; end if;
  if video.owner_id=auth.uid() then raise exception 'Self review denied' using errcode='42501'; end if;
  if not exists(select 1 from public.private_media_assets a join public.upload_reservations r on r.id=a.reservation_id where r.version_id=review_video_version.version_id and a.state='ready' and r.state='consumed') then raise exception 'Verified provider readiness required' using errcode='22023'; end if;
  update public.video_versions set state=case when approve then 'published' else 'rejected' end,reviewed_by=auth.uid(),reviewed_at=now() where id=version_id;
  insert into public.video_review_notes(version_id,reviewer_id,reason,approved) values(version_id,auth.uid(),reason,approve);
  if approve then update public.videos set state='published',active_version_id=version_id,published_at=now() where id=video.id; end if;
  if not approve then perform public.queue_media_deletion(a.id) from public.private_media_assets a join public.upload_reservations r on r.id=a.reservation_id where r.version_id=review_video_version.version_id; end if;
  insert into public.media_audit(actor_id,action,subject_id,reason) values(auth.uid(),case when approve then 'version_published' else 'version_rejected' end,version_id,reason);
end;
$$;
create function public.moderate_video(video_id uuid,action text,reason text) returns void language plpgsql security definer set search_path='' as $$
declare video public.videos;
begin
  if not public.can_review_media() then raise exception 'Moderator required' using errcode='42501'; end if;
  if action is null or action not in ('hide','remove') or reason is null or char_length(reason) not between 5 and 1000 then raise exception 'Invalid moderation action' using errcode='22023'; end if;
  select * into video from public.videos where id=video_id for update;
  if not found then raise exception 'Video not found' using errcode='22023'; end if;
  if video.state='removed' then return; end if;
  update public.videos set state=case when action='hide' then 'hidden' else 'removed' end,active_version_id=null where id=video_id;
  if action='remove' then update public.video_versions set state='removed' where video_versions.video_id=moderate_video.video_id; end if;
  perform public.queue_media_deletion(a.id) from public.private_media_assets a join public.upload_reservations r on r.id=a.reservation_id join public.video_versions vv on vv.id=r.version_id where vv.video_id=moderate_video.video_id;
  insert into public.media_audit(actor_id,action,subject_id,reason) values(auth.uid(),action,video_id,reason);
end;
$$;

-- Explicit allowlist. The owner-executed view exposes only current approved metadata;
-- underlying private tables have no anonymous grants. Never add SELECT * here.
create view public.public_catalog with (security_barrier=true) as
  select v.id,vv.id as version_id,v.owner_id as creator_id,
    vv.metadata->>'title' as title,vv.metadata->>'description' as description,vv.metadata->>'format' as format,
    vv.metadata->'genres' as genres,vv.metadata->'regions' as regions,
    (select jsonb_agg(vl.language_slug order by vl.language_slug) from public.video_languages vl where vl.version_id=vv.id) as languages,
    vv.metadata->'tags' as tags,true as ai_disclosed,v.published_at,vv.duration_seconds
  from public.videos v join public.video_versions vv on vv.id=v.active_version_id
  where v.state='published' and vv.state='published' and not public.creator_is_suspended(v.owner_id);
revoke all on public.public_catalog from public,anon,authenticated;
grant select on public.public_catalog to anon,authenticated;

create function public.playback_entitlement(video_id uuid,viewer_id uuid,requested_version_id uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare video public.videos; selected_version_id uuid; provider_uid text; may_review boolean;
begin
  select * into video from public.videos where id=video_id;
  if not found or video.state in ('hidden','removed') or public.creator_is_suspended(video.owner_id) then return null; end if;
  select exists(select 1 from public.user_roles where user_id=viewer_id and role in ('moderator','admin')) into may_review;
  selected_version_id:=coalesce(requested_version_id,case when video.state='published' then video.active_version_id else video.latest_version_id end);
  if selected_version_id is distinct from video.active_version_id or video.state<>'published' then
    if viewer_id is null or (viewer_id<>video.owner_id and not may_review) then return null; end if;
  end if;
  if not exists(select 1 from public.video_versions vv where vv.id=selected_version_id and vv.video_id=video.id and vv.state in ('pending_review','published')) then return null; end if;
  select a.provider_uid into provider_uid from public.private_media_assets a join public.upload_reservations r on r.id=a.reservation_id where r.version_id=selected_version_id and a.state='ready';
  if provider_uid is null then return null; end if;
  return jsonb_build_object('provider_uid',provider_uid,'version_id',selected_version_id,'expires_at',now()+interval '60 seconds');
end;
$$;
create function public.claim_media_deletions(batch_size integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare jobs jsonb;
begin
  perform public.expire_upload_reservations();
  update public.media_deletion_jobs set state='exhausted' where attempts>=10 and state<>'completed' and (lease_until is null or lease_until<=now());
  with candidates as (
    select id from public.media_deletion_jobs where attempts<10 and
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
create function public.finish_media_deletion(job_id uuid,lease_token uuid,succeeded boolean,error_message text) returns void language plpgsql security definer set search_path='' as $$
declare job public.media_deletion_jobs;
begin
  select * into job from public.media_deletion_jobs j where j.id=job_id for update;
  if not found or succeeded is null or job.state<>'processing' or job.lease_token is distinct from lease_token or job.lease_until<=now() then raise exception 'Valid deletion lease required' using errcode='42501'; end if;
  if succeeded then
    update public.private_media_assets set state='deleted' where id=job.asset_id;
    update public.media_deletion_jobs set state='completed',completed_at=now(),lease_token=null,lease_until=null,last_error=null where id=job_id;
  else
    update public.media_deletion_jobs set state=case when attempts>=10 then 'exhausted' else 'retry' end,
      next_attempt_at=now()+make_interval(secs=>least(3600,30*(2^least(attempts,7))::integer)),last_error=left(error_message,1000),lease_token=null,lease_until=null where id=job_id;
  end if;
end;
$$;

-- Explicit execute allowlists; internal provider facts and viewer IDs are never browser inputs.
revoke all on function public.submit_creator_application(jsonb),public.decide_creator_application(uuid,boolean,text),public.validate_video_metadata(jsonb),public.immutable_version_metadata(),public.create_video_version(uuid,jsonb),public.queue_media_deletion(uuid),public.expire_upload_reservations(),public.reserve_video_upload(uuid,text),public.begin_upload_grant(uuid),public.mark_upload_grant_failure(uuid,boolean,text),public.bind_video_provider(uuid,text),public.reconcile_video_provider(text,text,text,integer,uuid),public.review_video_version(uuid,boolean,text),public.moderate_video(uuid,text,text),public.playback_entitlement(uuid,uuid,uuid),public.claim_media_deletions(integer),public.finish_media_deletion(uuid,uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.submit_creator_application(jsonb),public.decide_creator_application(uuid,boolean,text),public.create_video_version(uuid,jsonb),public.reserve_video_upload(uuid,text),public.review_video_version(uuid,boolean,text),public.moderate_video(uuid,text,text) to authenticated;
grant execute on function public.begin_upload_grant(uuid),public.mark_upload_grant_failure(uuid,boolean,text),public.bind_video_provider(uuid,text),public.reconcile_video_provider(text,text,text,integer,uuid),public.playback_entitlement(uuid,uuid,uuid),public.expire_upload_reservations(),public.claim_media_deletions(integer),public.finish_media_deletion(uuid,uuid,boolean,text) to service_role;
