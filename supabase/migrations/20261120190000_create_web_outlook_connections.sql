-- OAuth refresh tokens are only accessed by the Outlook Edge Function using
-- the service role. They must never be exposed through the browser API.
create table public.web_outlook_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  refresh_token text not null,
  scopes text[] not null default '{}',
  connected_at timestamptz not null default now()
);

alter table public.web_outlook_connections enable row level security;
revoke all on public.web_outlook_connections from public, anon, authenticated;
grant select, insert, update, delete on public.web_outlook_connections to service_role;

-- Keep the existing delivery ledger shared while routing each delivery to its
-- actual provider. Older rows remain Gmail deliveries by default.
alter table public.web_gmail_deliveries
  add column provider text not null default 'gmail' check (provider in ('gmail', 'outlook'));
grant insert, update, delete on public.web_gmail_deliveries to service_role;
