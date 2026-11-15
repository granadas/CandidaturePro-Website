create function public.get_my_web_tracking_counts()
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  select jsonb_build_object(
    'replies', count(*) filter (
      where status in ('sent', 'reply_received', 'interview', 'accepted', 'rejected')
        and last_inbound_at is not null
        and (last_reply_read_at is null or last_inbound_at > last_reply_read_at)
    ),
    'followups', count(*) filter (
      where next_follow_up_at is not null and status in ('sent', 'reply_received')
    ),
    'interviews', count(*) filter (where status = 'interview')
  )
  from public.user_applications
  where user_id = (select auth.uid()) and hidden_at is null;
$$;

revoke execute on function public.get_my_web_tracking_counts() from public, anon, authenticated;
grant execute on function public.get_my_web_tracking_counts() to authenticated;
