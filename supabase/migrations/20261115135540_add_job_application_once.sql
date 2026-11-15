alter table public.user_applications add column source_job_id uuid;

create function public.add_web_job_application(p_job_id uuid)
returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  candidate_id uuid := auth.uid();
  offer public.job_market_offers;
  application_id uuid;
  existing_hidden boolean;
  offer_url text;
begin
  if candidate_id is null then
    raise exception 'Connexion requise' using errcode = '42501';
  end if;

  select * into offer from public.job_market_offers where id = p_job_id and active;
  if not found then
    raise exception 'Cette annonce n’est plus disponible.';
  end if;
  offer_url := case when trim(offer.url) ~* '^https?://' then nullif(trim(offer.url), '') end;

  perform pg_advisory_xact_lock(hashtextextended('web-job-application:' || candidate_id::text, 0));
  select id, hidden_at is not null into application_id, existing_hidden
  from public.user_applications
  where user_id = candidate_id
    and (source_job_id = p_job_id or (offer_url is not null and source_url = offer_url))
  order by hidden_at is null desc, created_at
  limit 1;

  if found then
    return jsonb_build_object('id', application_id, 'created', false, 'hidden', existing_hidden);
  end if;
  if nullif(trim(offer.company_name), '') is null then
    raise exception 'L’annonce ne précise pas l’entreprise. Renseignez-la dans le formulaire Candidatures.';
  end if;

  insert into public.user_applications
    (user_id, company_name, company_city, job_title, source_url, source_job_id, status, source)
  values (candidate_id, left(trim(offer.company_name), 200), left(nullif(trim(offer.location), ''), 150),
          left(trim(offer.title), 200), offer_url, p_job_id, 'draft', 'web')
  returning id into application_id;
  return jsonb_build_object('id', application_id, 'created', true, 'hidden', false);
end;
$$;

revoke execute on function public.add_web_job_application(uuid) from public, anon, authenticated;
grant execute on function public.add_web_job_application(uuid) to authenticated;
