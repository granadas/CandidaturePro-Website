create or replace function public.update_own_candidate_profile(p_first_name text,p_last_name text,p_email text)
returns public.profiles language plpgsql security definer set search_path=''
as $$
declare candidate public.profiles;
first_name text := trim(coalesce(p_first_name,''));
last_name text := trim(coalesce(p_last_name,''));
email text := lower(trim(coalesce(p_email,'')));
begin
if auth.uid() is null then raise exception 'Connexion requise' using errcode='42501'; end if;
if char_length(first_name) not between 1 and 100 or char_length(last_name) not between 1 and 100
or char_length(email) not between 3 and 254 or email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
then raise exception 'Renseignez le prénom, le nom et une adresse e-mail valide.'; end if;
select * into candidate from public.profiles where id=auth.uid() for update;
if not found then raise exception 'Profil introuvable.'; end if;
if nullif(trim(candidate.candidate_first_name),'') is not null and nullif(trim(candidate.candidate_last_name),'') is not null
and nullif(trim(candidate.candidate_email),'') is not null then
 if first_name is distinct from candidate.candidate_first_name or last_name is distinct from candidate.candidate_last_name
 or email is distinct from lower(candidate.candidate_email) then
 raise exception 'Identité verrouillée. Envoyez une demande de correction à l’administration.'; end if;
 return candidate;
end if;
update public.profiles set candidate_first_name=first_name,candidate_last_name=last_name,candidate_email=email,
candidate_identity_set_at=now(),updated_at=now() where id=auth.uid() returning * into candidate;
return candidate;
end;
$$;
revoke all on function public.update_own_candidate_profile(text,text,text) from public,anon;
grant execute on function public.update_own_candidate_profile(text,text,text) to authenticated;

create function public.submit_web_identity_change(p_first_name text,p_last_name text,p_email text,p_reason text)
returns jsonb language plpgsql security invoker set search_path=''
as $$
declare candidate public.profiles; request_id bigint;
first_name text := trim(coalesce(p_first_name,'')); last_name text := trim(coalesce(p_last_name,''));
email text := lower(trim(coalesce(p_email,''))); reason text := trim(coalesce(p_reason,''));
begin
if auth.uid() is null then raise exception 'Connexion requise' using errcode='42501'; end if;
if char_length(first_name) not between 1 and 100 or char_length(last_name) not between 1 and 100
or char_length(email) not between 3 and 254 or email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
or char_length(reason) not between 10 and 2000 then raise exception 'Renseignez l’identité demandée et un motif de 10 à 2 000 caractères.'; end if;
perform pg_advisory_xact_lock(hashtextextended('web-identity:'||auth.uid()::text,0));
select * into candidate from public.profiles where id=auth.uid();
if not found or nullif(trim(candidate.candidate_first_name),'') is null or nullif(trim(candidate.candidate_last_name),'') is null
or nullif(trim(candidate.candidate_email),'') is null then raise exception 'Enregistrez d’abord votre identité dans Mon profil.'; end if;
select id into request_id from public.candidate_identity_change_requests where user_id=auth.uid() and status='pending' order by created_at limit 1;
if found then return jsonb_build_object('id',request_id,'created',false); end if;
if first_name=candidate.candidate_first_name and last_name=candidate.candidate_last_name and email=lower(candidate.candidate_email)
then raise exception 'L’identité demandée est identique à l’identité actuelle.'; end if;
insert into public.candidate_identity_change_requests(user_id,current_first_name,current_last_name,current_email,
requested_first_name,requested_last_name,requested_email,reason,status)
values(auth.uid(),candidate.candidate_first_name,candidate.candidate_last_name,candidate.candidate_email,first_name,last_name,email,reason,'pending')
returning id into request_id;
return jsonb_build_object('id',request_id,'created',true);
end;
$$;
revoke all on function public.submit_web_identity_change(text,text,text,text) from public,anon;
grant execute on function public.submit_web_identity_change(text,text,text,text) to authenticated;

create schema web_identity_private;
revoke all on schema web_identity_private from public,anon;
grant usage on schema web_identity_private to authenticated;

create function web_identity_private.list_requests()
returns setof public.candidate_identity_change_requests language plpgsql security definer set search_path=''
as $$
begin
if auth.uid() is null or not coalesce((select is_admin from public.profiles where id=auth.uid()),false)
then raise exception 'Accès administrateur requis' using errcode='42501'; end if;
return query select * from public.candidate_identity_change_requests where status='pending' order by created_at,id limit 200;
end;
$$;
create function web_identity_private.review_request(p_request_id bigint,p_approve boolean,p_note text)
returns boolean language plpgsql security definer set search_path=''
as $$
declare request public.candidate_identity_change_requests; candidate public.profiles;
begin
if auth.uid() is null or not coalesce((select is_admin from public.profiles where id=auth.uid()),false)
then raise exception 'Accès administrateur requis' using errcode='42501'; end if;
if p_approve is null or char_length(coalesce(p_note,''))>2000 then raise exception 'Décision invalide.'; end if;
select * into request from public.candidate_identity_change_requests where id=p_request_id for update;
if not found or request.status<>'pending' then return false; end if;
if p_approve then
 if char_length(trim(request.requested_first_name)) not between 1 and 100
 or char_length(trim(request.requested_last_name)) not between 1 and 100
 or char_length(request.requested_email) not between 3 and 254
 or request.requested_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
 then raise exception 'L’identité demandée est invalide. Refusez cette demande et demandez une nouvelle saisie.'; end if;
 select * into candidate from public.profiles where id=request.user_id for update;
 if not found or candidate.candidate_first_name is distinct from request.current_first_name
 or candidate.candidate_last_name is distinct from request.current_last_name
 or candidate.candidate_email is distinct from request.current_email then
 raise exception 'L’identité du compte a changé depuis la demande. Refusez-la et demandez une nouvelle saisie.'; end if;
 update public.profiles set candidate_first_name=trim(request.requested_first_name),candidate_last_name=trim(request.requested_last_name),
 candidate_email=lower(trim(request.requested_email)),candidate_identity_set_at=now(),updated_at=now() where id=request.user_id;
end if;
update public.candidate_identity_change_requests set status=case when p_approve then 'approved' else 'rejected' end,
reviewed_at=now(),admin_note=nullif(trim(p_note),'') where id=request.id;
perform public.log_admin_audit(case when p_approve then 'identity_change_approved' else 'identity_change_rejected' end,
'candidate_identity_change',request.id::text,'','Demande de correction de l’identité candidat',
jsonb_build_object('status','pending'),jsonb_build_object('status',case when p_approve then 'approved' else 'rejected' end));
return true;
end;
$$;
revoke all on function web_identity_private.list_requests() from public,anon;
revoke all on function web_identity_private.review_request(bigint,boolean,text) from public,anon;
grant execute on function web_identity_private.list_requests(),web_identity_private.review_request(bigint,boolean,text) to authenticated;

create function public.admin_list_web_identity_requests()
returns setof public.candidate_identity_change_requests language sql security invoker set search_path=''
as $$ select * from web_identity_private.list_requests(); $$;
create function public.admin_review_web_identity_request(p_request_id bigint,p_approve boolean,p_note text default '')
returns boolean language sql security invoker set search_path=''
as $$ select web_identity_private.review_request(p_request_id,p_approve,p_note); $$;
revoke all on function public.admin_list_web_identity_requests(),public.admin_review_web_identity_request(bigint,boolean,text) from public,anon;
grant execute on function public.admin_list_web_identity_requests(),public.admin_review_web_identity_request(bigint,boolean,text) to authenticated;
