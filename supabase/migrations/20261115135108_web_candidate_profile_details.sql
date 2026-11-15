create table public.web_candidate_profile_details (
  user_id uuid primary key references auth.users(id) on delete cascade,
  phone text not null check (char_length(phone) <= 60),
  city text not null check (char_length(city) <= 150),
  desired_jobs text not null check (char_length(desired_jobs) <= 1000),
  skills text not null check (char_length(skills) <= 3000),
  languages text not null check (char_length(languages) <= 1000)
);

alter table public.web_candidate_profile_details enable row level security;
revoke all on public.web_candidate_profile_details from public, anon, authenticated;
grant select, insert, update on public.web_candidate_profile_details to authenticated;
create policy "Manage own web profile details"
  on public.web_candidate_profile_details for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create function public.save_web_candidate_profile(
  p_first_name text, p_last_name text, p_email text, p_phone text, p_city text,
  p_desired_jobs text, p_skills text, p_languages text
) returns public.profiles language plpgsql security invoker set search_path = ''
as $$
declare
  candidate public.profiles;
begin
  if (select auth.uid()) is null then
    raise exception 'Connexion requise' using errcode = '42501';
  end if;

  candidate := public.update_own_candidate_profile(p_first_name, p_last_name, p_email);
  insert into public.web_candidate_profile_details (user_id, phone, city, desired_jobs, skills, languages)
  values ((select auth.uid()), trim(p_phone), trim(p_city), trim(p_desired_jobs), trim(p_skills), trim(p_languages))
  on conflict (user_id) do update
    set phone = excluded.phone, city = excluded.city, desired_jobs = excluded.desired_jobs,
        skills = excluded.skills, languages = excluded.languages;
  return candidate;
end;
$$;

revoke execute on function public.save_web_candidate_profile(text,text,text,text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.save_web_candidate_profile(text,text,text,text,text,text,text,text) to authenticated;
