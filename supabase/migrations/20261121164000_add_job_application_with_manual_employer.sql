CREATE OR REPLACE FUNCTION public.add_web_job_application_with_company(
  p_job_id uuid, p_company_name text
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
  candidate_id uuid := auth.uid();
  offer public.job_market_offers;
  application_id uuid;
  existing_hidden boolean;
  offer_url text;
  verified_name text := nullif(trim(p_company_name), '');
BEGIN
  IF candidate_id IS NULL THEN
    RAISE EXCEPTION 'Connexion requise' USING errcode = '42501';
  END IF;
  IF verified_name IS NULL OR length(verified_name) > 200 THEN
    RAISE EXCEPTION 'Indiquez le nom de l’entreprise (200 caractères au maximum).';
  END IF;

  SELECT * INTO offer FROM public.job_market_offers WHERE id = p_job_id AND active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cette annonce n’est plus disponible.';
  END IF;
  offer_url := CASE WHEN trim(offer.url) ~* '^https?://' THEN nullif(trim(offer.url), '') END;

  PERFORM pg_advisory_xact_lock(hashtextextended('web-job-application:' || candidate_id::text, 0));
  SELECT id, hidden_at IS NOT NULL INTO application_id, existing_hidden
  FROM public.user_applications
  WHERE user_id = candidate_id
    AND (source_job_id = p_job_id OR (offer_url IS NOT NULL AND source_url = offer_url))
  ORDER BY hidden_at IS NULL DESC, created_at
  LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('id', application_id, 'created', false, 'hidden', existing_hidden);
  END IF;

  INSERT INTO public.user_applications
    (user_id, company_name, company_city, job_title, source_url, source_job_id, status, source)
  VALUES
    (candidate_id, verified_name,
     left(nullif(nullif(trim(offer.location), 'À vérifier'), ''), 150),
     left(trim(offer.title), 200), offer_url, p_job_id, 'draft', 'web')
  RETURNING id INTO application_id;
  RETURN jsonb_build_object('id', application_id, 'created', true, 'hidden', false);
END;
$function$;

REVOKE ALL ON FUNCTION public.add_web_job_application_with_company(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_web_job_application_with_company(uuid, text) TO authenticated, service_role;
