create table public.web_cv_analysis_reports (
id uuid primary key default gen_random_uuid(),
user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
created_at timestamptz not null default now(),
cv_name text not null check (char_length(cv_name) between 1 and 120),
target_role text not null default '' check (char_length(target_role) <= 120),
overall smallint not null check (overall between 0 and 100),
structure smallint not null check (structure between 0 and 100),
content smallint not null check (content between 0 and 100),
keywords smallint not null check (keywords between 0 and 100),
readability smallint not null check (readability between 0 and 100),
ats smallint not null check (ats between 0 and 100)
);
alter table public.web_cv_analysis_reports enable row level security;
create index web_cv_analysis_owner_date on public.web_cv_analysis_reports (user_id, created_at desc);
revoke all on public.web_cv_analysis_reports from public, anon, authenticated;
grant select, insert, delete on public.web_cv_analysis_reports to authenticated;
create policy "Read own CV analysis reports" on public.web_cv_analysis_reports for select to authenticated using (user_id = (select auth.uid()));
create policy "Delete own CV analysis reports" on public.web_cv_analysis_reports for delete to authenticated using (user_id = (select auth.uid()));
create policy "Create own premium CV analysis reports" on public.web_cv_analysis_reports for insert to authenticated with check (
user_id = (select auth.uid()) and exists (
select 1 from public.profiles p where p.id = (select auth.uid()) and lower(p.plan) = 'premium'
and (p.premium_until is null or p.premium_until > now())));
