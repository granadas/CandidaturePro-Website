create function public.reserve_reviewed_web_gmail_delivery(
  p_user uuid, p_application uuid, p_email text, p_reviewed_at timestamptz
) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  current_version timestamptz;
begin
  -- Match the lock order of reserve_web_gmail_delivery.
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 0));

  select dossier.updated_at into current_version
  from public.user_applications as dossier
  where dossier.id = p_application and dossier.user_id = p_user
  for update;

  if not found or p_reviewed_at is null or current_version is distinct from p_reviewed_at then
    return jsonb_build_object('error', 'Dossier modifié depuis le contrôle final. Rouvrez-le avant l’envoi.');
  end if;

  return public.reserve_web_gmail_delivery(p_user, p_application, p_email);
end;
$$;

revoke execute on function public.reserve_reviewed_web_gmail_delivery(uuid,uuid,text,timestamptz)
  from public, anon, authenticated;
grant execute on function public.reserve_reviewed_web_gmail_delivery(uuid,uuid,text,timestamptz)
  to service_role;
