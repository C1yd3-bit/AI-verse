-- Public search reads only the allowlisted approved projection. No provider columns.
create function public.discover_catalog(filters jsonb, after_id uuid default null, expected_revision text default null, page_size integer default 20)
returns jsonb language plpgsql security definer set search_path='' as $$
declare key text; term jsonb; revision text; result jsonb; min_seconds integer; max_seconds integer;
begin
  if filters is null or jsonb_typeof(filters)<>'object' or octet_length(filters::text)>8192 or page_size is null or page_size not between 1 and 50 then raise exception 'Invalid discovery input' using errcode='22023'; end if;
  if exists(select 1 from jsonb_object_keys(filters) k where k not in ('keywords','regions','genres','formats','languages','hashtags','minDurationSeconds','maxDurationSeconds')) then raise exception 'Unknown discovery filter' using errcode='22023'; end if;
  foreach key in array array['keywords','regions','genres','formats','languages','hashtags'] loop
    if not filters ? key then filters:=filters||jsonb_build_object(key,'[]'::jsonb); end if;
    if jsonb_typeof(filters->key)<>'array' then raise exception 'Array filter required' using errcode='22023'; end if;
    if jsonb_array_length(filters->key)>32 then raise exception 'Too many filter values' using errcode='22023'; end if;
    for term in select value from jsonb_array_elements(filters->key) loop
      if jsonb_typeof(term)<>'string' or char_length(term#>>'{}') not between 1 and 80 then raise exception 'Invalid filter value' using errcode='22023'; end if;
    end loop;
  end loop;
  if exists(select 1 from jsonb_array_elements_text(filters->'genres') g where not exists(select 1 from public.genres where slug=g))
    or exists(select 1 from jsonb_array_elements_text(filters->'regions') r where not exists(select 1 from public.content_regions where slug=r))
    or exists(select 1 from jsonb_array_elements_text(filters->'languages') l where not exists(select 1 from public.languages where slug=l))
    or exists(select 1 from jsonb_array_elements_text(filters->'formats') f where f not in ('reel','movie')) then raise exception 'Unknown taxonomy filter' using errcode='22023'; end if;
  begin
    min_seconds:=(filters->>'minDurationSeconds')::integer; max_seconds:=(filters->>'maxDurationSeconds')::integer;
  exception when others then raise exception 'Invalid duration' using errcode='22023'; end;
  if coalesce(min_seconds,0)<0 or coalesce(max_seconds,10800)>10800 or coalesce(min_seconds,0)>coalesce(max_seconds,10800) then raise exception 'Invalid duration range' using errcode='22023'; end if;
  select md5(coalesce(string_agg(c.id::text||c.version_id::text,',' order by c.id),'')) into revision from public.public_catalog c;
  if after_id is not null and (expected_revision is null or expected_revision<>revision) then raise exception 'Catalog changed; restart discovery' using errcode='22023'; end if;
  with candidates as materialized (
    select c.* from public.public_catalog c where
      (jsonb_array_length(filters->'formats')=0 or c.format=any(array(select jsonb_array_elements_text(filters->'formats')))) and
      (jsonb_array_length(filters->'languages')=0 or c.languages ?| array(select jsonb_array_elements_text(filters->'languages'))) and
      (jsonb_array_length(filters->'hashtags')=0 or c.tags ?| array(select jsonb_array_elements_text(filters->'hashtags'))) and
      (min_seconds is null or c.duration_seconds>=min_seconds) and (max_seconds is null or c.duration_seconds<=max_seconds) and
      not exists(select 1 from jsonb_array_elements_text(filters->'keywords') word where position(lower(word) in lower(concat_ws(' ',c.title,c.description,c.tags::text,c.genres::text,c.regions::text,c.languages::text)))=0)
  ), exact as materialized (
    select c.* from candidates c where
      (jsonb_array_length(filters->'regions')=0 or filters->'regions' ? 'global' or c.regions ?| array(select jsonb_array_elements_text(filters->'regions'))) and
      (jsonb_array_length(filters->'genres')=0 or c.genres ?| array(select jsonb_array_elements_text(filters->'genres')))
  ), page as materialized (select * from exact where after_id is null or id>after_id order by id limit page_size),
  broader as (select * from candidates c where not exists(select 1 from exact e where e.id=c.id) and (select count(*) from exact)<page_size order by id limit 3)
  select jsonb_build_object('revision',revision,'exact',jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(p) order by p.id) from page p),'[]'::jsonb),'total',(select count(*) from exact),'nextId',case when (select count(*) from exact where after_id is null or id>after_id)>page_size then (select id from page order by id desc limit 1) else null end),'broader',jsonb_build_object('label','Broader suggestions — content region and genre filters relaxed','items',coalesce((select jsonb_agg(to_jsonb(b) order by b.id) from broader b),'[]'::jsonb))) into result;
  return result;
end;
$$;
revoke all on function public.discover_catalog(jsonb,uuid,text,integer) from public;
grant execute on function public.discover_catalog(jsonb,uuid,text,integer) to anon,authenticated;
