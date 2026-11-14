alter table public.user_applications
  add column last_follow_up_sent_at timestamptz,
  add column follow_up_delay_days integer not null default 10
    check (follow_up_delay_days between 1 and 365);

create function public.confirm_web_gmail_thread_send(
  p_user_id uuid, p_request_id uuid, p_previous_reminder timestamptz
) returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  delivery public.web_gmail_thread_sends;
begin
  update public.web_gmail_thread_sends
    set confirmed_at = now()
    where user_id = p_user_id and request_id = p_request_id and confirmed_at is null
    returning * into delivery;
  if not found then
    return exists (
      select 1 from public.web_gmail_thread_sends
      where user_id = p_user_id and request_id = p_request_id and confirmed_at is not null
    );
  end if;

  if delivery.kind = 'followup' then
    update public.user_applications
      set last_follow_up_sent_at = greatest(last_follow_up_sent_at, delivery.confirmed_at),
          last_activity_at = greatest(last_activity_at, delivery.confirmed_at),
          next_follow_up_at = case
            when status = 'sent' and hidden_at is null and last_inbound_at is null
              and next_follow_up_at is not distinct from p_previous_reminder
              then delivery.confirmed_at + follow_up_delay_days * interval '1 day'
            else next_follow_up_at
          end
      where id = delivery.application_id and user_id = delivery.user_id;
  end if;
  return true;
end;
$$;

revoke execute on function public.confirm_web_gmail_thread_send(uuid, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.confirm_web_gmail_thread_send(uuid, uuid, timestamptz)
  to service_role;
