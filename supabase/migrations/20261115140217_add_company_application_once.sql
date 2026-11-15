create function public.add_web_company_application(p_company text, p_city text, p_email text)
returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  candidate_id uuid := auth.uid();
  company_name_value text := trim(p_company);
  city_value text := nullif(trim(p_city), '');
  application_id uuid;
  existing_hidden boolean;
begin
  if candidate_id is null then
    raise exception 'Connexion requise' using errcode = '42501';
  end if;
  if company_name_value is null or char_length(company_name_value) not between 1 and 200 then
    raise exception 'Vérifiez le nom de l’entreprise.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('web-company-application:' || candidate_id::text, 0));
  select id, hidden_at is not null into application_id, existing_hidden
  from public.user_applications
  where user_id = candidate_id
    and nullif(trim(job_title), '') is null and source_url is null and source_job_id is null
    and lower(trim(company_name)) = lower(company_name_value)
    and lower(nullif(trim(company_city), '')) is not distinct from lower(city_value)
  order by hidden_at is null desc, created_at
  limit 1;

  if found then
    return jsonb_build_object('id', application_id, 'created', false, 'hidden', existing_hidden);
  end if;

  insert into public.user_applications (user_id, company_name, company_city, company_email, status, source)
  values (candidate_id, company_name_value, city_value, nullif(trim(p_email), ''), 'draft', 'web')
  returning id into application_id;
  return jsonb_build_object('id', application_id, 'created', true, 'hidden', false);
end;
$$;

revoke execute on function public.add_web_company_application(text,text,text) from public, anon, authenticated;
grant execute on function public.add_web_company_application(text,text,text) to authenticated;
