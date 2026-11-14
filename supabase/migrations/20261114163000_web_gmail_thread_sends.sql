create table public.web_gmail_thread_sends (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  application_id uuid not null,
  kind text not null check (kind in ('reply', 'followup')),
  confirmed_at timestamptz,
  primary key (user_id, request_id)
);

alter table public.web_gmail_thread_sends enable row level security;
revoke all on public.web_gmail_thread_sends from public, anon, authenticated;
grant select, insert, update, delete on public.web_gmail_thread_sends to service_role;
