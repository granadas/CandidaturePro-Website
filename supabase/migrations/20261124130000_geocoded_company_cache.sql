-- Coordinates are optional: older results and web-only findings cannot be placed precisely.
alter table public.company_search_cache add column latitude double precision;
alter table public.company_search_cache add column longitude double precision;
create index company_search_cache_geocoded_idx on public.company_search_cache (sector)
  where latitude is not null and longitude is not null;

create table public.company_search_centers (
  city_key text primary key,
  latitude double precision not null,
  longitude double precision not null,
  updated_at timestamptz not null default now()
);
alter table public.company_search_centers enable row level security;
revoke all on public.company_search_centers from public, anon, authenticated;

create function public.remember_geocoded_company_search(
  p_sector text, p_city text, p_radius text, p_companies jsonb, p_center jsonb)
returns integer language plpgsql security definer set search_path = public, auth, pg_temp as $$
declare v_count integer; v_lat float8; v_lon float8; v_item jsonb; v_key text;
  v_company_key text; v_identity text; v_item_lat float8; v_item_lon float8;
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;
  -- Preserve the existing validation, blocklist and canonical-contact writer.
  v_count := public.remember_company_search(p_sector,p_city,p_radius,p_companies);
  if jsonb_typeof(p_center) <> 'object'
    or coalesce(p_center->>'latitude','') !~ '^-?[0-9]{1,3}(\.[0-9]+)?$'
    or coalesce(p_center->>'longitude','') !~ '^-?[0-9]{1,3}(\.[0-9]+)?$' then
    return v_count;
  end if;
  v_lat := (p_center->>'latitude')::float8;
  v_lon := (p_center->>'longitude')::float8;
  if v_lat not between 45.5 and 48.2 or v_lon not between 5.5 and 11.0 then return v_count; end if;
  insert into public.company_search_centers(city_key,latitude,longitude,updated_at)
  values(lower(trim(p_city)),v_lat,v_lon,now())
  on conflict(city_key) do update set latitude=excluded.latitude,
    longitude=excluded.longitude,updated_at=now();
  v_key := public.normalize_company_search_key(p_sector,p_city,p_radius::integer);
  for v_item in select value from jsonb_array_elements(p_companies) loop
    if coalesce(v_item->>'latitude','') !~ '^-?[0-9]{1,3}(\.[0-9]+)?$'
      or coalesce(v_item->>'longitude','') !~ '^-?[0-9]{1,3}(\.[0-9]+)?$' then continue; end if;
    v_item_lat := (v_item->>'latitude')::float8;
    v_item_lon := (v_item->>'longitude')::float8;
    if v_item_lat not between 45.5 and 48.2 or v_item_lon not between 5.5 and 11.0 then continue; end if;
    v_company_key := public.normalize_company_key(v_item->>'name',coalesce(v_item->>'city',p_city,''));
    v_identity := md5(v_company_key || '|' || coalesce(
      nullif(lower(trim(coalesce(v_item->>'address',''))),''),
      nullif(lower(trim(coalesce(v_item->>'website',''))),''),''));
    update public.company_search_cache c set latitude=v_item_lat,longitude=v_item_lon
    where c.search_key=v_key and c.cache_identity=v_identity;
  end loop;
  return v_count;
end $$;
revoke all on function public.remember_geocoded_company_search(text,text,text,jsonb,jsonb) from public, anon;
grant execute on function public.remember_geocoded_company_search(text,text,text,jsonb,jsonb) to authenticated;

create function public.get_geocoded_company_search(p_sector text,p_city text,p_radius text)
returns table(company_id bigint, company_name text, city text, sector text, email text,
  website text, address text, phone text, company_status text, refreshed_at timestamptz,
  is_fresh boolean)
language plpgsql stable security definer set search_path = public, auth, pg_temp as $$
declare v_radius integer;
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;
  if coalesce(p_radius,'') !~ '^[0-9]{1,3}$' or length(trim(coalesce(p_sector,''))) > 300
    or length(trim(coalesce(p_city,''))) > 200 then raise exception 'Critères invalides'; end if;
  v_radius := p_radius::integer;
  if v_radius < 1 or v_radius > 100 then raise exception 'Rayon invalide'; end if;
  return query
  with located as (
    select distinct on(c.cache_identity) c.*
    from public.company_search_centers target
    join public.company_search_cache c on c.latitude is not null and c.longitude is not null
    where target.city_key=lower(trim(p_city))
      and (trim(p_sector)='' or lower(trim(c.sector))=lower(trim(p_sector)))
      and 6371 * acos(least(1.0,greatest(-1.0,
        sin(radians(target.latitude))*sin(radians(c.latitude)) +
        cos(radians(target.latitude))*cos(radians(c.latitude)) *
        cos(radians(c.longitude-target.longitude))))) <= v_radius
    order by c.cache_identity,c.refreshed_at desc
  )
  select c.company_id,c.company_name,c.city,c.sector,
    case when exists(select 1 from public.company_blocked_emails b
                     where b.company_key=c.company_key and b.email=chosen.mail)
         then '' else chosen.mail end,
    coalesce(nullif(d.website,''),c.website),c.address,c.phone,
    coalesce(d.company_status,'active'),c.refreshed_at,
    c.refreshed_at >= now()-interval '14 days'
  from located c left join public.company_directory d on d.company_key=c.company_key
  cross join lateral (select lower(trim(coalesce(nullif(d.hr_email,''),
       nullif(d.general_email,''),nullif(c.email,''),''))) as mail) chosen
  where coalesce(d.company_status,'active') <> 'inactive'
  order by c.company_name limit 100;
end $$;
revoke all on function public.get_geocoded_company_search(text,text,text) from public, anon;
grant execute on function public.get_geocoded_company_search(text,text,text) to authenticated;
