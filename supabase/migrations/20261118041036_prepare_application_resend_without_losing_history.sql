alter table public.user_applications add column resend_of uuid;
create index user_applications_resend_origin_idx on public.user_applications (user_id, resend_of) where resend_of is not null;
create function public.create_web_resend_draft(p_application_id uuid)
returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
candidate_id uuid := auth.uid();
original public.user_applications;
draft_id uuid;
existing_hidden boolean;
begin
if candidate_id is null then raise exception 'Connexion requise' using errcode='42501'; end if;
perform pg_advisory_xact_lock(hashtextextended('web-resend:' || candidate_id::text || ':' || p_application_id::text, 0));
select * into original from public.user_applications
where id=p_application_id and user_id=candidate_id for update;
if not found or original.sent_at is null then raise exception 'Sélectionnez une candidature déjà envoyée.'; end if;
select id, hidden_at is not null into draft_id, existing_hidden from public.user_applications
where user_id=candidate_id and resend_of=p_application_id and status in ('draft','ready')
order by created_at limit 1;
if found then return jsonb_build_object('id',draft_id,'created',false,'hidden',existing_hidden); end if;
insert into public.user_applications
(user_id,company_name,company_city,company_email,job_title,status,source,source_url,source_job_id,follow_up_delay_days,resend_of)
values
(candidate_id,original.company_name,original.company_city,original.company_email,original.job_title,'draft','web',original.source_url,original.source_job_id,original.follow_up_delay_days,p_application_id)
returning id into draft_id;
return jsonb_build_object('id',draft_id,'created',true,'hidden',false);
end;
$$;
revoke all on function public.create_web_resend_draft(uuid) from public, anon, authenticated;
grant execute on function public.create_web_resend_draft(uuid) to authenticated;
