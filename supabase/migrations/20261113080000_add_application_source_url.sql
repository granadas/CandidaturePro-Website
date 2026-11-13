alter table public.user_applications
add column source_url text
check (source_url is null or char_length(source_url) <= 2000);

revoke select on table public.job_market_offers from anon;
grant select on table public.job_market_offers to authenticated;
