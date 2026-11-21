-- Give each claimed refresh an unpredictable token used by the completion RPC.
CREATE OR REPLACE FUNCTION public.claim_my_company_contact_refresh()
 RETURNS TABLE(request_id text, company_name text, city text, blocked_email text, claim_token text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_user uuid := auth.uid();
    v_id uuid;
    v_claim_token uuid := gen_random_uuid();
begin
    if v_user is null then
        raise exception 'Authentification requise';
    end if;

    -- Clean up stale queue rows whose company was declared inactive after
    -- the job was created. They no longer require any contact discovery.
    update public.company_contact_refresh_queue q
    set status = 'resolved',
        processed_at = now(),
        processing_started_at = null,
        processing_claimed_by = null,
        processing_claim_token = null
    where q.requested_by = v_user
      and q.status in ('pending','processing')
      and exists(
          select 1
          from public.company_directory d
          where d.company_key = q.company_key
            and d.company_status = 'inactive'
      );

    -- Claim only one item atomically. A processing lease older than
    -- 15 minutes is considered abandoned and can safely be reclaimed.
    select q.id into v_id
    from public.company_contact_refresh_queue q
    where q.requested_by = v_user
      -- Do not spend client/provider work on a company that Admin has
      -- already declared closed/nonexistent. The completion RPC also keeps
      -- its independent inactive guard for race-condition safety.
      and not exists(
          select 1
          from public.company_directory d
          where d.company_key = q.company_key
            and d.company_status = 'inactive'
      )
      and (
          q.status = 'pending'
          or (
              q.status = 'processing'
              and coalesce(q.processing_started_at,q.created_at)
                    < now() - interval '15 minutes'
          )
      )
    order by q.created_at
    for update skip locked
    limit 1;

    if v_id is null then
        return;
    end if;

    update public.company_contact_refresh_queue q
    set status = 'processing',
        processing_started_at = now(),
        processing_claimed_by = v_user,
        processing_claim_token = v_claim_token
    where q.id = v_id;

    return query
    select
        q.id::text,
        q.company_name,
        q.city,
        q.blocked_email,
        q.processing_claim_token::text
    from public.company_contact_refresh_queue q
    where q.id = v_id;
end;
$function$
;
