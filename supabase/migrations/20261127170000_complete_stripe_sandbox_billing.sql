-- Complete the existing sandbox-only Stripe billing tables without relaxing
-- the livemode=false constraints added by the initial billing migration.
create table if not exists public.stripe_sandbox_subscriptions (
  subscription_id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  customer_id text not null,
  price_id text not null,
  status text not null,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  livemode boolean not null default false check (livemode = false),
  updated_at timestamptz not null default now()
);

create table if not exists public.stripe_sandbox_events (
  event_id text primary key,
  event_type text not null,
  event_created_at timestamptz not null,
  livemode boolean not null default false check (livemode = false),
  processed_at timestamptz
);

alter table public.stripe_sandbox_subscriptions
  add column if not exists last_event_created_at timestamptz;

alter table public.stripe_sandbox_subscriptions enable row level security;
alter table public.stripe_sandbox_events enable row level security;
create index if not exists stripe_sandbox_subscriptions_user_updated_idx
  on public.stripe_sandbox_subscriptions(user_id, updated_at desc);

create or replace function public.apply_stripe_sandbox_subscription_event(
  p_event_id text,
  p_event_type text,
  p_event_created_at timestamptz,
  p_subscription_id text,
  p_user_id uuid,
  p_customer_id text,
  p_price_id text,
  p_status text,
  p_current_period_end timestamptz,
  p_cancel_at_period_end boolean
) returns text
language plpgsql security definer
set search_path = public, auth, pg_temp as $$
declare
  v_inserted integer;
  v_entitled_until timestamptz;
begin
  if p_event_id !~ '^evt_[A-Za-z0-9]+$'
     or p_event_type not in ('customer.subscription.created','customer.subscription.updated','customer.subscription.deleted')
     or p_subscription_id !~ '^sub_[A-Za-z0-9]+$'
     or p_customer_id !~ '^cus_[A-Za-z0-9]+$'
     or p_price_id !~ '^price_[A-Za-z0-9]+$'
     or p_status not in ('active','trialing','past_due','unpaid','canceled','incomplete','incomplete_expired','paused')
     or p_user_id is null then
    raise exception 'Événement Stripe sandbox invalide';
  end if;

  insert into public.stripe_sandbox_events(event_id,event_type,event_created_at,livemode,processed_at)
  values(p_event_id,p_event_type,p_event_created_at,false,null)
  on conflict(event_id) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then return 'duplicate'; end if;

  insert into public.stripe_sandbox_subscriptions(
    subscription_id,user_id,customer_id,price_id,status,current_period_end,cancel_at_period_end,livemode,updated_at,last_event_created_at
  ) values (
    p_subscription_id,p_user_id,p_customer_id,p_price_id,p_status,p_current_period_end,
    coalesce(p_cancel_at_period_end,false),false,now(),p_event_created_at
  )
  on conflict(subscription_id) do update set
    user_id=excluded.user_id,
    customer_id=excluded.customer_id,
    price_id=excluded.price_id,
    status=excluded.status,
    current_period_end=excluded.current_period_end,
    cancel_at_period_end=excluded.cancel_at_period_end,
    livemode=false,
    updated_at=now(),
    last_event_created_at=excluded.last_event_created_at
  where public.stripe_sandbox_subscriptions.last_event_created_at is null
     or public.stripe_sandbox_subscriptions.last_event_created_at <= excluded.last_event_created_at;

  select max(current_period_end) into v_entitled_until
  from public.stripe_sandbox_subscriptions
  where user_id=p_user_id
    and (status in ('active','trialing') or (status='past_due' and current_period_end > now()));

  update public.profiles
  set plan=case when v_entitled_until > now() then 'premium' else 'free' end,
      premium_until=case when v_entitled_until > now() then v_entitled_until else null end,
      updated_at=now()
  where id=p_user_id;

  update public.stripe_sandbox_events set processed_at=now() where event_id=p_event_id;
  return 'processed';
end $$;

revoke all on function public.apply_stripe_sandbox_subscription_event(text,text,timestamptz,text,uuid,text,text,text,timestamptz,boolean) from public, anon, authenticated;
grant execute on function public.apply_stripe_sandbox_subscription_event(text,text,timestamptz,text,uuid,text,text,text,timestamptz,boolean) to service_role;
