create table if not exists public.web_outlook_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  refresh_token text not null,
  scopes text[] not null default '{}',
  connected_at timestamptz not null default now()
);

alter table public.web_outlook_connections enable row level security;
-- No client RLS policy: only the authenticated outlook-web Edge Function
-- reads or writes refresh tokens through the server-side service role.
