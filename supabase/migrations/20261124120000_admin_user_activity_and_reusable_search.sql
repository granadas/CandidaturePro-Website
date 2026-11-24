-- Bounded, admin-only activity view. A draft application is never counted as a sent email.
create or replace function public.admin_get_user_activity(p_user_id uuid)
returns jsonb language plpgsql stable security definer
set search_path = public, auth, pg_temp as $$
declare v_result jsonb;
begin
  if not coalesce((select is_admin from public.profiles where id = auth.uid()), false) then
    raise exception 'Accès administrateur requis';
  end if;
  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'Compte introuvable';
  end if;
  select jsonb_build_object(
    'searches', coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at desc)
      from (select sector, city, created_at from public.company_search_events
            where user_id = p_user_id order by created_at desc limit 30) e), '[]'::jsonb),
    'search_count', (select count(*) from public.company_search_events where user_id = p_user_id),
    'internet_search_count', (select count(*) from public.company_search_usage where user_id = p_user_id),
    'sent_count', (select count(*) from public.web_gmail_deliveries
      where user_id = p_user_id and message_id is not null),
    'follow_up_count', (select count(*) from public.web_gmail_thread_sends
      where user_id = p_user_id and confirmed_at is not null),
    'recent_sends', coalesce((select jsonb_agg(to_jsonb(s) order by s.sent_at desc)
      from (select a.company_name, a.company_city, a.sent_at
            from public.user_applications a join public.web_gmail_deliveries d on d.application_id = a.id
            where d.user_id = p_user_id and d.message_id is not null
            order by a.sent_at desc nulls last limit 20) s), '[]'::jsonb)
  ) into v_result;
  return v_result;
end $$;
revoke all on function public.admin_get_user_activity(uuid) from public, anon;
grant execute on function public.admin_get_user_activity(uuid) to authenticated;

-- Reuse only searches with the same centre and a radius no larger than requested.
-- These are guaranteed to fall in the requested area; broader caches cannot be safely narrowed.
create or replace function public.get_reusable_company_search(p_sector text, p_city text, p_radius text)
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
  if v_radius > 500 then raise exception 'Rayon invalide'; end if;
  return query
  with matching as (
    select distinct on (c.cache_identity) c.*, r.radius
    from generate_series(0, v_radius - 1) as r(radius)
    join public.company_search_cache c
      on c.search_key = public.normalize_company_search_key(p_sector,p_city,r.radius)
    order by c.cache_identity, r.radius desc, c.refreshed_at desc
  )
  select c.company_id,c.company_name,c.city,c.sector,
    case when exists(select 1 from public.company_blocked_emails b
                     where b.company_key=c.company_key and b.email=chosen.mail)
         then '' else chosen.mail end,
    coalesce(nullif(d.website,''),c.website),c.address,c.phone,
    coalesce(d.company_status,'active'),c.refreshed_at,
    c.refreshed_at >= now() - interval '14 days'
  from matching c left join public.company_directory d on d.company_key=c.company_key
  cross join lateral (select lower(trim(coalesce(nullif(d.hr_email,''),
       nullif(d.general_email,''),nullif(c.email,''),''))) as mail) chosen
  where coalesce(d.company_status,'active') <> 'inactive'
  order by c.company_name limit 100;
end $$;
revoke all on function public.get_reusable_company_search(text,text,text) from public, anon;
grant execute on function public.get_reusable_company_search(text,text,text) to authenticated;
