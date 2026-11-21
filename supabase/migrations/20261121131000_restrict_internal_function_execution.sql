-- Internal trigger functions are only called by table triggers. Admin refresh RPCs require a signed-in administrator.
revoke execute on function public.admin_store_job_market_offers(uuid,jsonb), public.job_market_can_start_refresh(integer) from anon;
revoke execute on function public.audit_company_directory_changes(), public.audit_email_change_changes(), public.audit_invalid_email_changes(), public.close_verifications_when_contact_exists() from public, anon, authenticated;
