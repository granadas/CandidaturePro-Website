create table public.web_gmail_deliveries (
  application_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  month_start date not null,
  message_id text,
  reserved_at timestamptz not null default now()
);
alter table public.web_gmail_deliveries enable row level security;
revoke all on public.web_gmail_deliveries from public, anon, authenticated;
grant select on public.web_gmail_deliveries to service_role;

create function public.reserve_web_gmail_delivery(p_user uuid, p_application uuid, p_email text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  dossier public.user_applications%rowtype;
  quota jsonb;
  quota_month date := date_trunc('month', now())::date;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 0));
  select * into dossier from public.user_applications
    where id = p_application and user_id = p_user for update;
  if not found then return jsonb_build_object('error', 'Candidature introuvable.'); end if;
  if exists (select 1 from public.web_gmail_deliveries where application_id = p_application) then
    return jsonb_build_object('error', 'Un envoi existe déjà pour cette candidature. Vérifiez le dossier Envoyés dans Gmail.');
  end if;
  if dossier.hidden_at is not null or dossier.sent_at is not null or dossier.status <> 'ready'
    or dossier.company_email is distinct from p_email then
    return jsonb_build_object('error', 'Actualisez la candidature et vérifiez son statut et son destinataire.');
  end if;
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  if public.is_company_email_blocked(dossier.company_name, dossier.company_city, p_email) then
    return jsonb_build_object('error', 'Cette adresse est bloquée dans la base entreprises.');
  end if;
  quota := public.consume_my_candidature('web-gmail:' || p_application::text, null, dossier.company_name, left(dossier.company_city, 120));
  if not (quota->>'allowed')::boolean then return jsonb_build_object('error', 'Limite mensuelle atteinte.'); end if;
  insert into public.web_gmail_deliveries(application_id, user_id, month_start)
    values (p_application, p_user, quota_month);
  return jsonb_build_object('reserved', true);
end;
$$;

create function public.finish_web_gmail_delivery(p_user uuid, p_application uuid, p_message text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare quota_month date;
begin
  if p_message is null then
    delete from public.web_gmail_deliveries
      where application_id = p_application and user_id = p_user and message_id is null
      returning month_start into quota_month;
    if found then
      delete from public.candidature_usage
        where user_id = p_user and month_start = quota_month
          and application_key = 'web-gmail:' || p_application::text;
    end if;
  else
    update public.web_gmail_deliveries set message_id = p_message
      where application_id = p_application and user_id = p_user and message_id is null;
    if not found then raise exception 'Réservation introuvable'; end if;
    update public.user_applications
      set status = 'sent', sent_at = now(), last_activity_at = now()
      where id = p_application and user_id = p_user;
  end if;
end;
$$;

revoke all on function public.reserve_web_gmail_delivery(uuid,uuid,text), public.finish_web_gmail_delivery(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.reserve_web_gmail_delivery(uuid,uuid,text), public.finish_web_gmail_delivery(uuid,uuid,text) to service_role;
