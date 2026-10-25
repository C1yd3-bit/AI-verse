-- Explicit UTF-16 bounds, shared by the account API and database. Zod 4.6
-- counts code points by default, so the API also applies explicit unit checks.
alter table public.account_details drop constraint account_details_full_name_check;
alter table public.account_details add constraint account_details_full_name_check check(public.media_text_length(full_name) between 1 and 80);
alter table public.account_details drop constraint account_details_ethnicity_check;
alter table public.account_details add constraint account_details_ethnicity_check check(ethnicity is null or public.media_text_length(ethnicity) between 1 and 100);

create or replace function public.complete_account_onboarding(payload jsonb) returns void language plpgsql security definer set search_path='' as $$
declare viewer uuid:=auth.uid(); full_name_value text; age_value integer; contact_value text; ethnicity_value text; consent_value boolean; genre_values text[]; region_values text[]; pref jsonb;
begin
  if viewer is null or not public.has_verified_email() then raise exception 'Verified email required' using errcode='42501'; end if;
  if payload is null or jsonb_typeof(payload)<>'object' or octet_length(payload::text)>8192 then raise exception 'Invalid onboarding' using errcode='22023'; end if;
  if not(payload ?& array['fullName','age','contactNumber','preferences','ethnicity','ethnicityConsent'])
    or exists(select 1 from jsonb_object_keys(payload) k where k not in ('fullName','age','contactNumber','preferences','ethnicity','ethnicityConsent')) then raise exception 'Invalid onboarding fields' using errcode='22023'; end if;
  if jsonb_typeof(payload->'fullName') is distinct from 'string'
    or jsonb_typeof(payload->'age') is distinct from 'number'
    or payload->>'age' !~ '^[0-9]{1,3}$'
    or jsonb_typeof(payload->'ethnicityConsent') is distinct from 'boolean' then raise exception 'Invalid information types' using errcode='22023'; end if;
  full_name_value:=public.trim_media_text(payload->>'fullName');age_value:=(payload->>'age')::integer;
  if public.media_text_length(full_name_value) not between 1 and 80 or age_value not between 1 and 120 then raise exception 'Invalid name or age' using errcode='22023'; end if;
  if payload->'contactNumber'<>'null'::jsonb then
    if jsonb_typeof(payload->'contactNumber')<>'string' then raise exception 'Invalid contact number' using errcode='22023'; end if;
    contact_value:=public.trim_media_text(payload->>'contactNumber');
    if public.media_text_length(contact_value) not between 7 and 32 or contact_value !~ '^\+?[0-9() .-]+$'
      or char_length(regexp_replace(contact_value,'[^0-9]','','g')) not between 7 and 15 then raise exception 'Invalid contact number' using errcode='22023'; end if;
  end if;
  consent_value:=(payload->>'ethnicityConsent')::boolean;
  if payload->'ethnicity'<>'null'::jsonb then
    if jsonb_typeof(payload->'ethnicity')<>'string' or not consent_value then raise exception 'Explicit ethnicity consent required' using errcode='22023'; end if;
    ethnicity_value:=public.trim_media_text(payload->>'ethnicity');
    if public.media_text_length(ethnicity_value) not between 1 and 100 then raise exception 'Invalid self-description' using errcode='22023'; end if;
  elsif consent_value then raise exception 'Consent requires an optional self-description' using errcode='22023'; end if;
  pref:=payload->'preferences';
  if jsonb_typeof(pref) is distinct from 'object' or not(pref ?& array['status','genres','regions']) then raise exception 'Invalid preferences' using errcode='22023'; end if;
  if exists(select 1 from jsonb_object_keys(pref) k where k not in ('status','genres','regions'))
    or jsonb_typeof(pref->'status') is distinct from 'string' or jsonb_typeof(pref->'genres') is distinct from 'array' or jsonb_typeof(pref->'regions') is distinct from 'array' then raise exception 'Invalid preference fields' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(pref->'genres') x where jsonb_typeof(x)<>'string')
    or exists(select 1 from jsonb_array_elements(pref->'regions') x where jsonb_typeof(x)<>'string') then raise exception 'Invalid preference selections' using errcode='22023'; end if;
  select coalesce(array_agg(value),'{}'::text[]) into genre_values from jsonb_array_elements_text(pref->'genres');
  select coalesce(array_agg(value),'{}'::text[]) into region_values from jsonb_array_elements_text(pref->'regions');
  perform 1 from public.profiles where id=viewer for update;
  -- All private information and interests commit together or roll back.
  perform public.save_viewer_preferences(pref->>'status',genre_values,region_values);
  insert into public.account_details(user_id,full_name,age,contact_number,ethnicity,ethnicity_consent,ethnicity_consented_at)
    values(viewer,full_name_value,age_value,contact_value,ethnicity_value,consent_value,case when consent_value then now() else null end)
    on conflict(user_id) do update set full_name=excluded.full_name,age=excluded.age,contact_number=excluded.contact_number,
      ethnicity=excluded.ethnicity,ethnicity_consent=excluded.ethnicity_consent,
      ethnicity_consented_at=case when excluded.ethnicity_consent then case when account_details.ethnicity=excluded.ethnicity and account_details.ethnicity_consent then account_details.ethnicity_consented_at else now() end else null end,
      updated_at=now();
  -- Do not copy a private full name into profiles or any creator/public projection.
end;
$$;
revoke all on function public.complete_account_onboarding(jsonb) from public,anon,authenticated;
grant execute on function public.complete_account_onboarding(jsonb) to authenticated;

