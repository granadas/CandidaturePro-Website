create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.user_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  company_name text not null check (char_length(trim(company_name)) between 1 and 200),
  company_city text check (company_city is null or char_length(company_city) <= 150),
  company_email text check (company_email is null or char_length(company_email) <= 254),
  job_title text check (job_title is null or char_length(job_title) <= 200),
  status text not null default 'draft' check (
    status in ('draft','ready','sent','reply_received','interview','accepted','rejected','archived')
  ),
  source text not null default 'web' check (source in ('web','desktop','import')),
  notes text check (notes is null or char_length(notes) <= 5000),
  sent_at timestamptz,
  last_activity_at timestamptz not null default now(),
  next_follow_up_at timestamptz,
  last_inbound_at timestamptz,
  hidden_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_applications enable row level security;

revoke all on table public.user_applications from anon;
revoke all on table public.user_applications from authenticated;
grant select, insert, update, delete on table public.user_applications to authenticated;

create policy "Users can read own applications"
on public.user_applications
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can create own applications"
on public.user_applications
for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "Users can update own applications"
on public.user_applications
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users can delete own applications"
on public.user_applications
for delete
to authenticated
using ((select auth.uid()) = user_id);

create index user_applications_user_activity_idx
on public.user_applications (user_id, last_activity_at desc);

create index user_applications_user_status_idx
on public.user_applications (user_id, status)
where hidden_at is null;

create trigger user_applications_set_updated_at
before update on public.user_applications
for each row execute function private.set_updated_at();

revoke execute on function public.update_own_candidate_profile(text, text, text) from anon;
