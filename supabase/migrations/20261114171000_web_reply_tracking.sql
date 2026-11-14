alter table public.user_applications
  add column last_automatic_reply_at timestamptz,
  add column last_human_reply_at timestamptz,
  add column last_reply_read_at timestamptz;

create function public.record_web_gmail_replies(
  p_user uuid, p_application uuid, p_automatic timestamptz, p_human timestamptz
) returns boolean
language sql security invoker set search_path = ''
as $$
  with changed as (
    update public.user_applications
    set last_automatic_reply_at = greatest(last_automatic_reply_at, p_automatic),
        last_human_reply_at = greatest(last_human_reply_at, p_human),
        last_inbound_at = greatest(last_inbound_at, p_automatic, p_human),
        status = case when status = 'sent' then 'reply_received' else status end
    where user_id = p_user and id = p_application and hidden_at is null
      and status in ('sent', 'reply_received', 'interview', 'accepted', 'rejected')
      and (
        (p_automatic is not null and (last_automatic_reply_at is null or p_automatic > last_automatic_reply_at))
        or (p_human is not null and (last_human_reply_at is null or p_human > last_human_reply_at))
      )
    returning id
  )
  select exists (select 1 from changed);
$$;

revoke execute on function public.record_web_gmail_replies(uuid, uuid, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.record_web_gmail_replies(uuid, uuid, timestamptz, timestamptz)
  to service_role;
