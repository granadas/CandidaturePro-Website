create table public.web_cv_variants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  label text not null check (char_length(trim(label)) between 1 and 120),
  fields jsonb not null check (jsonb_typeof(fields) = 'object' and octet_length(fields::text) <= 150000),
  updated_at timestamptz not null default now()
);
alter table public.web_cv_variants enable row level security;
revoke all on public.web_cv_variants from public, anon, authenticated;
grant select, insert, update, delete on public.web_cv_variants to authenticated;
create index web_cv_variants_owner_idx on public.web_cv_variants(user_id, updated_at desc);
create policy "Manage own CV variants" on public.web_cv_variants
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
