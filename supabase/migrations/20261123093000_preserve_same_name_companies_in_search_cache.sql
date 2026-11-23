-- A name and city identify a directory record, but not a search result:
-- distinct establishments can have the same generic name in one city.
alter table public.company_search_cache
    add column cache_identity text;

update public.company_search_cache
set cache_identity = md5(company_key || '|' || coalesce(nullif(lower(trim(address)), ''), lower(trim(website)), ''));

alter table public.company_search_cache
    alter column cache_identity set not null;

alter table public.company_search_cache
    drop constraint company_search_cache_pkey;

alter table public.company_search_cache
    add constraint company_search_cache_pkey primary key (search_key, cache_identity);

create index company_search_cache_company_key_idx
    on public.company_search_cache (company_key);

-- Recreate the writer below with the new row identity, while retaining
-- company_key for canonical email, blocklist and inactive-company checks.
CREATE OR REPLACE FUNCTION public.remember_company_search(p_sector text, p_city text, p_radius text, p_companies jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_radius integer;
    v_key text;
    v_item jsonb;
    v_company_key text;
    v_cache_identity text;
    v_count integer := 0;
    v_external_email text;
    v_safe_email text;
begin
    if auth.uid() is null then
        raise exception 'Authentification requise';
    end if;

    if coalesce(p_radius,'') !~ '^[0-9]{1,3}$' then
        raise exception 'Rayon invalide';
    end if;
    v_radius := p_radius::integer;
    if v_radius > 500 then
        raise exception 'Rayon invalide';
    end if;

    if length(trim(coalesce(p_sector,''))) > 300
       or length(trim(coalesce(p_city,''))) > 200
       or length(trim(coalesce(p_radius,''))) > 30 then
        raise exception 'Critères de recherche trop volumineux';
    end if;

    if jsonb_typeof(p_companies) <> 'array' then
        raise exception 'Liste entreprises invalide';
    end if;

    -- Defensive limits: the shared cache is fed by the Windows client, so a
    -- malformed/modified client must not be able to submit an unbounded JSON
    -- payload or thousands of rows in a single RPC call.
    if jsonb_array_length(p_companies) > 500 then
        raise exception 'Trop d’entreprises dans une seule recherche';
    end if;

    if pg_column_size(p_companies) > 2000000 then
        raise exception 'Données de recherche trop volumineuses';
    end if;

    v_key := public.normalize_company_search_key(
        p_sector,p_city,v_radius);

    if v_key is null or v_key = '' then
        raise exception 'Clé de recherche invalide';
    end if;

    delete from public.company_search_cache
    where search_key = v_key;

    for v_item in
        select value from jsonb_array_elements(p_companies)
    loop
        if length(trim(coalesce(v_item->>'name',''))) < 2 then
            continue;
        end if;

        -- Bound every cached company field independently. The global 2 MB
        -- payload limit does not prevent a single malformed row from carrying
        -- abnormally large text values.
        if length(trim(coalesce(v_item->>'name',''))) > 300
           or length(trim(coalesce(v_item->>'city',p_city,''))) > 200
           or length(trim(coalesce(v_item->>'sector',p_sector,''))) > 300
           or length(trim(coalesce(v_item->>'email',''))) > 320
           or length(trim(coalesce(v_item->>'website',''))) > 2000
           or length(trim(coalesce(v_item->>'address',''))) > 1000
           or length(trim(coalesce(v_item->>'phone',''))) > 100
           or length(coalesce(v_item->>'source','')) > 500 then
            continue;
        end if;

        v_company_key := public.normalize_company_key(
            v_item->>'name',
            coalesce(v_item->>'city',p_city,''));

        if v_company_key is null or v_company_key = '' then
            continue;
        end if;

        -- Never re-store a company that Admin has declared inactive.
        -- This keeps the shared cache clean in addition to the read-side
        -- filtering added in RC39.
        if exists(
            select 1
            from public.company_directory d
            where d.company_key = v_company_key
              and d.company_status = 'inactive'
        ) then
            continue;
        end if;

        -- The same name in the same city may represent several branches.
        -- Use the address (or website when there is no address) for the
        -- cache row, while the canonical directory key remains unchanged.
        v_cache_identity := md5(
            v_company_key || '|' || coalesce(
                nullif(lower(trim(coalesce(v_item->>'address',''))), ''),
                nullif(lower(trim(coalesce(v_item->>'website',''))), ''),
                ''
            )
        );

        v_external_email :=
            lower(trim(coalesce(v_item->>'email','')));

        -- An address already confirmed invalid must never be reintroduced
        -- by a later external refresh.
        if v_external_email <> '' and exists(
            select 1
            from public.company_blocked_emails b
            where b.company_key = v_company_key
              and b.email = v_external_email
        ) then
            v_safe_email := '';
        else
            v_safe_email := v_external_email;
        end if;

        insert into public.company_search_cache(
            search_key,cache_identity,company_key,company_id,company_name,city,sector,
            email,website,address,phone,source,refreshed_at
        )
        values(
            v_key,
            v_cache_identity,
            v_company_key,
            case
                when coalesce(v_item->>'id','') ~ '^[0-9]{1,18}$'
                then (v_item->>'id')::bigint
                else 0
            end,
            trim(coalesce(v_item->>'name','')),
            trim(coalesce(v_item->>'city',p_city,'')),
            trim(coalesce(v_item->>'sector',p_sector,'')),
            v_safe_email,
            trim(coalesce(v_item->>'website','')),
            trim(coalesce(v_item->>'address','')),
            trim(coalesce(v_item->>'phone','')),
            left(coalesce(v_item->>'source',''),500),
            now()
        )
        on conflict(search_key,cache_identity)
        do update set
            company_key=excluded.company_key,
            company_id=excluded.company_id,
            company_name=excluded.company_name,
            city=excluded.city,
            sector=excluded.sector,
            email=excluded.email,
            website=excluded.website,
            address=excluded.address,
            phone=excluded.phone,
            source=excluded.source,
            refreshed_at=now();

        -- Ordinary search refreshes may improve identity/location/website,
        -- but MUST NOT replace an already-known canonical email.
        insert into public.company_directory(
            company_key,company_name,city,website,general_email,
            company_status,source,updated_at
        )
        values(
            v_company_key,
            trim(coalesce(v_item->>'name','')),
            trim(coalesce(v_item->>'city',p_city,'')),
            trim(coalesce(v_item->>'website','')),
            v_safe_email,
            'active',
            'company_search_cache',
            now()
        )
        on conflict(company_key)
        do update set
            company_name=excluded.company_name,
            city=excluded.city,
            website=case
                when excluded.website<>'' then excluded.website
                else company_directory.website
            end,
            general_email=case
                when coalesce(company_directory.general_email,'')=''
                 and coalesce(company_directory.hr_email,'')=''
                 and excluded.general_email<>''
                then excluded.general_email
                else company_directory.general_email
            end,
            updated_at=now();

        v_count := v_count + 1;
    end loop;

    return v_count;
end;
$function$
;
