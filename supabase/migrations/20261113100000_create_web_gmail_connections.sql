create table public.web_gmail_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  refresh_token text not null,
  connected_at timestamptz not null default now()
);

alter table public.web_gmail_connections enable row level security;
revoke all on public.web_gmail_connections from public, anon, authenticated;
grant select, insert, update, delete on public.web_gmail_connections to service_role;
