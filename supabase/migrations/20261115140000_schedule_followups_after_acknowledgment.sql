create or replace function public.confirm_web_gmail_thread_send(
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
            when status in ('sent', 'reply_received') and hidden_at is null and last_human_reply_at is null
              and ((status = 'sent' and last_inbound_at is null) or
                   (last_inbound_at is not null and last_inbound_at = last_automatic_reply_at))
              and next_follow_up_at is not distinct from p_previous_reminder
              then delivery.confirmed_at + follow_up_delay_days * interval '1 day'
            else next_follow_up_at
          end
      where id = delivery.application_id and user_id = delivery.user_id;
  end if;
  return true;
end;
$$;
