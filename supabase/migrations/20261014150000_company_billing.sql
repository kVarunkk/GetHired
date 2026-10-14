-- Company billing model (plan/feature-recruiter-billing-spec.md §3, BL-TASK-010).
--
-- 1. Plans: company_tiers under migrations, plus tier_entitlements (§5.1).
-- 2. company_subscriptions (one per company, free by default), company_usage,
--    company_usage_events, company_entitlement_holds, company_credit_ledger,
--    company_billing_audit, and the payments columns for company purchases.
-- 3. RLS: members read their own billing rows; nothing is writable by clients.
-- 4. Functions: company_effective_tier, check/consume/hold/release,
--    grant_company_credits, set_company_plan, get_company_entitlements,
--    rollover_free_periods, billing_usage_alerts / mark_usage_notified.
--
-- Idempotent: safe to run twice. Seeded rows use "on conflict do nothing", so
-- prices and allowances edited later aren't overwritten by a rerun.
--
-- Note on privileges: the project's default privileges grant EXECUTE on new
-- functions and ALL on new tables to anon and authenticated, so every object
-- here revokes them explicitly.

-- ===========================================================================
-- 1. Plans
-- ===========================================================================

create table if not exists public.company_tiers (
  id uuid primary key default gen_random_uuid(),
  name text,
  allowed_job_posts int,
  allowed_profiles int,
  price_plan_id uuid references public.price_plan(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

alter table public.company_tiers
  add column if not exists slug text,
  add column if not exists is_public boolean not null default true,
  add column if not exists sort smallint not null default 0,
  add column if not exists description text,
  add column if not exists features text[] not null default '{}',
  -- [{ interval: 'month'|'year', currency: 'INR'|'USD', amount_minor: int, dodo_product_id: text|null }]
  add column if not exists prices jsonb not null default '[]'::jsonb;

create unique index if not exists company_tiers_slug_key on public.company_tiers (slug);

-- The live tiers (BLT-000): 'free', and two hand-assigned legacy tiers.
update public.company_tiers set slug = 'free' where name = 'free' and slug is null;
update public.company_tiers set slug = name, is_public = false
 where name in ('paid-1', 'paid-2') and slug is null;

insert into public.company_tiers (slug, name, is_public, sort) values
  ('free', 'Free', true, 0),
  ('startup', 'Startup', true, 1),
  ('growth', 'Growth', true, 2),
  ('enterprise', 'Enterprise', true, 3),
  ('founding', 'Founding', false, 1)
on conflict (slug) do nothing;

update public.company_tiers t set
  name = v.name,
  sort = v.sort,
  description = v.description,
  features = v.features,
  prices = v.prices
from (values
  ('free', 'Free', 0,
   'Post a job, see matched candidates and screen applicants.',
   array['2 active job posts', '50 AI screenings a month', '20 candidates per talent search', 'Pipeline board and notes'],
   '[]'::jsonb),
  ('startup', 'Startup', 1,
   'For founders hiring their first team.',
   array['10 active job posts', '500 AI screenings a month', 'Unlimited talent search', '150 outreach messages a month', '600 AI interview minutes a month', '5 seats'],
   '[{"interval":"month","currency":"USD","amount_minor":4900,"dodo_product_id":null},
     {"interval":"year","currency":"USD","amount_minor":49000,"dodo_product_id":null},
     {"interval":"month","currency":"INR","amount_minor":299900,"dodo_product_id":null},
     {"interval":"year","currency":"INR","amount_minor":2999000,"dodo_product_id":null}]'::jsonb),
  ('growth', 'Growth', 2,
   'For teams hiring across several roles.',
   array['30 active job posts', '2,000 AI screenings a month', 'Unlimited talent search', '600 outreach messages a month', '2,400 AI interview minutes a month', '15 seats'],
   '[{"interval":"month","currency":"USD","amount_minor":14900,"dodo_product_id":null},
     {"interval":"year","currency":"USD","amount_minor":149000,"dodo_product_id":null},
     {"interval":"month","currency":"INR","amount_minor":899900,"dodo_product_id":null},
     {"interval":"year","currency":"INR","amount_minor":8999000,"dodo_product_id":null}]'::jsonb),
  ('enterprise', 'Enterprise', 3,
   'Custom volumes, SSO later, and a contract.',
   array['Unlimited job posts and seats', 'Custom allowances', 'Priority support'],
   '[]'::jsonb),
  ('founding', 'Founding', 1,
   'Startup, free for companies that joined before launch.',
   array['Everything in Startup'],
   '[]'::jsonb)
) as v(slug, name, sort, description, features, prices)
where t.slug = v.slug and t.description is null;

alter table public.company_tiers enable row level security;

create table if not exists public.tier_entitlements (
  tier_id uuid not null references public.company_tiers(id) on delete cascade,
  -- Keep in sync with EntitlementKey in helpers/billing/keys.ts.
  key text not null check (key in ('active_job_posts', 'seats', 'profiles_per_search',
    'screenings', 'outreach', 'interview_minutes', 'agent_messages', 'match_explanations')),
  kind text not null check (kind in ('limit', 'allowance')),
  amount int check (amount >= 0),                    -- null = unlimited
  overage_credits int check (overage_credits >= 0),  -- allowance only; null = hard stop
  primary key (tier_id, key),
  check (kind = 'allowance' or overage_credits is null)
);

alter table public.tier_entitlements enable row level security;

-- §5.1. paid-1/paid-2 keep their job post and profile limits, with Startup's
-- and Growth's allowances.
insert into public.tier_entitlements (tier_id, key, kind, amount, overage_credits)
select t.id, v.key, v.kind, v.amount, v.overage
from (values
  ('free', 'active_job_posts', 'limit', 2, null),
  ('free', 'seats', 'limit', 2, null),
  ('free', 'profiles_per_search', 'limit', 20, null),
  ('free', 'screenings', 'allowance', 50, null),
  ('free', 'match_explanations', 'allowance', 50, null),
  ('free', 'outreach', 'allowance', 10, null),
  ('free', 'interview_minutes', 'allowance', 30, 1),
  ('free', 'agent_messages', 'allowance', 100, null),

  ('startup', 'active_job_posts', 'limit', 10, null),
  ('startup', 'seats', 'limit', 5, null),
  ('startup', 'profiles_per_search', 'limit', null, null),
  ('startup', 'screenings', 'allowance', 500, 1),
  ('startup', 'match_explanations', 'allowance', 1000, 0),
  ('startup', 'outreach', 'allowance', 150, 2),
  ('startup', 'interview_minutes', 'allowance', 600, 1),
  ('startup', 'agent_messages', 'allowance', 2000, 0),

  ('founding', 'active_job_posts', 'limit', 10, null),
  ('founding', 'seats', 'limit', 5, null),
  ('founding', 'profiles_per_search', 'limit', null, null),
  ('founding', 'screenings', 'allowance', 500, 1),
  ('founding', 'match_explanations', 'allowance', 1000, 0),
  ('founding', 'outreach', 'allowance', 150, 2),
  ('founding', 'interview_minutes', 'allowance', 600, 1),
  ('founding', 'agent_messages', 'allowance', 2000, 0),

  ('paid-1', 'active_job_posts', 'limit', 5, null),
  ('paid-1', 'seats', 'limit', 5, null),
  ('paid-1', 'profiles_per_search', 'limit', null, null),
  ('paid-1', 'screenings', 'allowance', 500, 1),
  ('paid-1', 'match_explanations', 'allowance', 1000, 0),
  ('paid-1', 'outreach', 'allowance', 150, 2),
  ('paid-1', 'interview_minutes', 'allowance', 600, 1),
  ('paid-1', 'agent_messages', 'allowance', 2000, 0),

  ('growth', 'active_job_posts', 'limit', 30, null),
  ('growth', 'seats', 'limit', 15, null),
  ('growth', 'profiles_per_search', 'limit', null, null),
  ('growth', 'screenings', 'allowance', 2000, 1),
  ('growth', 'match_explanations', 'allowance', null, null),
  ('growth', 'outreach', 'allowance', 600, 2),
  ('growth', 'interview_minutes', 'allowance', 2400, 1),
  ('growth', 'agent_messages', 'allowance', null, null),

  ('paid-2', 'active_job_posts', 'limit', null, null),
  ('paid-2', 'seats', 'limit', 15, null),
  ('paid-2', 'profiles_per_search', 'limit', null, null),
  ('paid-2', 'screenings', 'allowance', 2000, 1),
  ('paid-2', 'match_explanations', 'allowance', null, null),
  ('paid-2', 'outreach', 'allowance', 600, 2),
  ('paid-2', 'interview_minutes', 'allowance', 2400, 1),
  ('paid-2', 'agent_messages', 'allowance', null, null),

  ('enterprise', 'active_job_posts', 'limit', null, null),
  ('enterprise', 'seats', 'limit', null, null),
  ('enterprise', 'profiles_per_search', 'limit', null, null),
  ('enterprise', 'screenings', 'allowance', null, null),
  ('enterprise', 'match_explanations', 'allowance', null, null),
  ('enterprise', 'outreach', 'allowance', null, null),
  ('enterprise', 'interview_minutes', 'allowance', null, null),
  ('enterprise', 'agent_messages', 'allowance', null, null)
) as v(slug, key, kind, amount, overage)
join public.company_tiers t on t.slug = v.slug
on conflict (tier_id, key) do nothing;

-- ===========================================================================
-- 2. Subscriptions, usage, holds, credits
-- ===========================================================================

create table if not exists public.company_subscriptions (
  company_id uuid primary key references public.company_info(id) on delete cascade,
  tier_id uuid not null references public.company_tiers(id),
  status text not null default 'active'
    check (status in ('active', 'past_due', 'cancelled', 'expired')),
  billing_interval text check (billing_interval in ('month', 'year')),
  currency text,
  dodo_customer_id text,
  dodo_subscription_id text unique,
  current_period_start timestamptz not null default date_trunc('day', now()),
  current_period_end timestamptz not null default date_trunc('day', now()) + interval '1 month',
  cancel_at_period_end boolean not null default false,
  scheduled_tier_id uuid references public.company_tiers(id),   -- downgrade at period end
  grace_until timestamptz,
  manual_until timestamptz,          -- admin-granted plan end (pilots, founding)
  updated_at timestamptz not null default now()
);

create table if not exists public.company_usage (
  company_id uuid not null references public.company_info(id) on delete cascade,
  period_start timestamptz not null,
  key text not null,
  used int not null default 0 check (used >= 0),
  notified_80 boolean not null default false,
  notified_100 boolean not null default false,
  primary key (company_id, period_start, key)
);

create table if not exists public.company_usage_events (       -- idempotency + audit for consumption
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.company_info(id) on delete cascade,
  key text not null,
  qty int not null check (qty > 0),
  source text not null check (source in ('allowance', 'credits', 'mixed')),
  credits_spent int not null default 0,
  ref_type text not null,
  ref_id text not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (ref_type, ref_id, key)
);

create table if not exists public.company_entitlement_holds (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.company_info(id) on delete cascade,
  key text not null,
  qty int not null check (qty > 0),
  ref_type text not null,
  ref_id text not null,
  expires_at timestamptz not null default now() + interval '30 days',
  created_at timestamptz not null default now(),
  unique (ref_type, ref_id, key)
);

-- Credit lots (delta > 0, with remaining) and movements (delta < 0).
create table if not exists public.company_credit_ledger (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.company_info(id) on delete cascade,
  delta int not null check (delta <> 0),
  reason text not null check (reason in
    ('purchase', 'grant', 'opening_balance', 'consume', 'refund', 'expire', 'adjust')),
  remaining int check (remaining >= 0),
  expires_at timestamptz,
  key text,
  ref_type text,
  ref_id text,
  payment_id uuid references public.payments(id),
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check ((delta > 0) = (remaining is not null))
);

create index if not exists company_credit_ledger_lots_idx
  on public.company_credit_ledger (company_id, expires_at) where remaining > 0;
create unique index if not exists company_credit_ledger_payment_key
  on public.company_credit_ledger (payment_id) where payment_id is not null and delta > 0;

-- Plan grants and other admin actions (BL-REQ-015). Credit grants are in the ledger.
create table if not exists public.company_billing_audit (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.company_info(id) on delete cascade,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Company purchases (§3.3).
alter table public.payments
  add column if not exists company_id uuid references public.company_info(id) on delete set null,
  add column if not exists kind text not null default 'applicant_credits',
  add column if not exists tier_id uuid references public.company_tiers(id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.payments'::regclass and conname = 'payments_kind_check'
  ) then
    alter table public.payments add constraint payments_kind_check
      check (kind in ('applicant_credits', 'company_credits', 'company_subscription'));
  end if;
end $$;

-- ===========================================================================
-- 3. RLS
-- ===========================================================================

-- Plans: public ones for everyone (pricing page), plus the caller's own tier
-- (founding and legacy tiers aren't public). Writes only by the service role.
drop policy if exists "allow authenticated users to select" on public.company_tiers;
drop policy if exists "Public plans are readable" on public.company_tiers;
drop policy if exists "Members can read their own plan" on public.company_tiers;
create policy "Public plans are readable"
  on public.company_tiers for select to anon, authenticated
  using (is_public);
create policy "Members can read their own plan"
  on public.company_tiers for select to authenticated
  using (id in (select s.tier_id from public.company_subscriptions s));

drop policy if exists "Public plan entitlements are readable" on public.tier_entitlements;
drop policy if exists "Members can read their own plan entitlements" on public.tier_entitlements;
create policy "Public plan entitlements are readable"
  on public.tier_entitlements for select to anon, authenticated
  using (exists (select 1 from public.company_tiers t where t.id = tier_id and t.is_public));
create policy "Members can read their own plan entitlements"
  on public.tier_entitlements for select to authenticated
  using (tier_id in (select s.tier_id from public.company_subscriptions s));

revoke all on public.company_tiers, public.tier_entitlements from anon, authenticated;
grant select on public.company_tiers, public.tier_entitlements to anon, authenticated;

-- Billing state: members read their own rows; no client writes (BL-SEC-003/005).
do $$
declare t text;
begin
  foreach t in array array['company_subscriptions', 'company_usage', 'company_usage_events',
                           'company_entitlement_holds', 'company_credit_ledger']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "Members can read their company''s rows" on public.%I', t);
    execute format(
      'create policy "Members can read their company''s rows" on public.%I for select to authenticated using (public.is_company_member(company_id))',
      t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

alter table public.company_billing_audit enable row level security;
revoke all on public.company_billing_audit from anon, authenticated;

-- company_info: protect_company_info_columns (20261014120000) already resets
-- tier_id, ai_credits, job_posts_created and ai_search_uses for `authenticated`.
-- A column-level REVOKE would be a no-op here: authenticated holds table-level
-- UPDATE. The trigger stays the enforcement; it now finds the free tier by slug.
create or replace function public.protect_company_info_columns()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_role = 'authenticated' then
    if tg_op = 'INSERT' then
      -- The column defaults: new companies start on the free tier.
      new.tier_id := (select t.id from public.company_tiers t where t.slug = 'free');
      new.ai_credits := 50;
      new.job_posts_created := 0;
      new.ai_search_uses := 0;
    else
      new.tier_id := old.tier_id;
      new.ai_credits := old.ai_credits;
      new.job_posts_created := old.job_posts_created;
      new.ai_search_uses := old.ai_search_uses;
    end if;
  end if;
  return new;
end;
$$;

-- ===========================================================================
-- 4. Functions
-- ===========================================================================

create or replace function public.billing_free_tier_id()
returns uuid
language sql stable security definer
set search_path = public, pg_temp
as $$
  select id from public.company_tiers where slug = 'free'
$$;

create or replace function public.billing_is_limit_key(p_key text)
returns boolean
language sql immutable
set search_path = public, pg_temp
as $$
  select p_key in ('active_job_posts', 'seats', 'profiles_per_search')
$$;

create or replace function public.billing_assert_key(p_key text)
returns void
language plpgsql immutable
set search_path = public, pg_temp
as $$
begin
  if p_key is null or p_key not in ('active_job_posts', 'seats', 'profiles_per_search',
      'screenings', 'outreach', 'interview_minutes', 'agent_messages', 'match_explanations') then
    raise exception 'unknown entitlement key: %', p_key using errcode = 'invalid_parameter_value';
  end if;
end;
$$;

-- The tier in force (BL-TEST-024).
create or replace function public.company_effective_tier(p_company_id uuid)
returns uuid
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select case
      when s.status in ('cancelled', 'expired') then null
      when s.status = 'past_due' and coalesce(s.grace_until, '-infinity'::timestamptz) < now() then null
      when s.manual_until is not null and s.manual_until < now() then null
      else s.tier_id
    end
    from public.company_subscriptions s
    where s.company_id = p_company_id
  ), public.billing_free_tier_id())
$$;

-- The usage period: allowances are monthly. It's the subscription period start,
-- moved forward by whole months, so annual plans reset monthly too, and a free
-- period the cron hasn't rolled over yet doesn't keep counting.
create or replace function public.billing_period_start(p_company_id uuid)
returns timestamptz
language sql stable security definer
set search_path = public, pg_temp
as $$
  select s.current_period_start + interval '1 month' * greatest(0, (
           extract(year from age(now(), s.current_period_start)) * 12
           + extract(month from age(now(), s.current_period_start)))::int)
    from public.company_subscriptions s
   where s.company_id = p_company_id
$$;

-- Live counts for limits. Nothing is stored, nothing resets.
create or replace function public.billing_limit_used(p_company_id uuid, p_key text)
returns int
language sql stable security definer
set search_path = public, pg_temp
as $$
  select case p_key
    when 'active_job_posts' then
      (select count(*)::int from public.job_postings jp
        where jp.company_id = p_company_id and jp.status = 'active')
    -- The owner. The teams spec adds members plus pending invites (BLT-103).
    when 'seats' then 1
    else 0
  end
$$;

create or replace function public.billing_allowance_used(p_company_id uuid, p_key text)
returns int
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select u.used from public.company_usage u
     where u.company_id = p_company_id
       and u.period_start = public.billing_period_start(p_company_id)
       and u.key = p_key
  ), 0)
$$;

create or replace function public.billing_held(p_company_id uuid, p_key text)
returns int
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(sum(h.qty), 0)::int from public.company_entitlement_holds h
   where h.company_id = p_company_id and h.key = p_key and h.expires_at > now()
$$;

create or replace function public.billing_credit_balance(p_company_id uuid)
returns int
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(sum(l.remaining), 0)::int from public.company_credit_ledger l
   where l.company_id = p_company_id and l.remaining > 0
     and (l.expires_at is null or l.expires_at > now())
$$;

-- company_info.ai_credits is a cached balance, written only here.
create or replace function public.billing_refresh_credit_cache(p_company_id uuid)
returns int
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_balance int := public.billing_credit_balance(p_company_id);
begin
  update public.company_info set ai_credits = v_balance where id = p_company_id;
  return v_balance;
end;
$$;

-- Read-only. { allowed, source, credits_needed, reason, kind, amount, used, held,
-- remaining, overage_credits, credit_balance }.
create or replace function public.check_entitlement(p_company_id uuid, p_key text, p_qty int default 1)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_tier uuid := public.company_effective_tier(p_company_id);
  v_kind text;
  v_amount int;
  v_overage int;
  v_used int;
  v_held int := 0;
  v_remaining int;
  v_needed int := 0;
  v_balance int := public.billing_credit_balance(p_company_id);
  v_reserved int;
  v_allowed boolean;
  v_source text;
  v_reason text;
begin
  perform public.billing_assert_key(p_key);
  if p_qty is null or p_qty <= 0 then
    raise exception 'qty must be positive' using errcode = 'invalid_parameter_value';
  end if;

  select e.kind, e.amount, e.overage_credits into v_kind, v_amount, v_overage
    from public.tier_entitlements e where e.tier_id = v_tier and e.key = p_key;
  if not found then
    -- Not in the plan: nothing allowed.
    v_kind := case when public.billing_is_limit_key(p_key) then 'limit' else 'allowance' end;
    v_amount := 0;
    v_overage := null;
  end if;

  if v_kind = 'limit' then
    v_used := public.billing_limit_used(p_company_id, p_key);
    if v_amount is null or p_key = 'profiles_per_search' then
      -- profiles_per_search is a cap on results, not something that runs out.
      v_allowed := true;
    else
      v_allowed := v_used + p_qty <= v_amount;
    end if;
    v_source := case when v_allowed then 'allowance' end;
    v_reason := case when not v_allowed then 'limit_reached' end;
    v_remaining := case when v_amount is null then null else greatest(v_amount - v_used, 0) end;
  else
    v_used := public.billing_allowance_used(p_company_id, p_key);
    v_held := public.billing_held(p_company_id, p_key);
    if v_amount is null then
      v_allowed := true;
      v_source := 'allowance';
    else
      v_remaining := greatest(v_amount - v_used - v_held, 0);
      if p_qty <= v_remaining then
        v_allowed := true;
        v_source := 'allowance';
      elsif v_overage is null then
        v_allowed := false;
        v_reason := 'limit_reached';
      else
        v_needed := (p_qty - v_remaining) * v_overage;
        -- Credits already set aside by holds that go past the allowance.
        v_reserved := (greatest(v_used + v_held - v_amount, 0) - greatest(v_used - v_amount, 0)) * v_overage;
        v_allowed := v_balance - v_reserved >= v_needed;
        if v_allowed then
          v_source := case when v_remaining > 0 then 'mixed' else 'credits' end;
        else
          v_reason := 'insufficient_credits';
        end if;
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'allowed', v_allowed,
    'source', v_source,
    'credits_needed', case when v_allowed or v_reason = 'insufficient_credits' then v_needed else 0 end,
    'reason', v_reason,
    'kind', v_kind,
    'amount', v_amount,
    'used', v_used,
    'held', v_held,
    'remaining', v_remaining,
    'overage_credits', v_overage,
    'credit_balance', v_balance
  );
end;
$$;

-- Spends credits FIFO by expiry. The caller holds the company lock.
create or replace function public.billing_spend_credits(
  p_company_id uuid, p_amount int, p_key text, p_ref_type text, p_ref_id text, p_actor uuid
)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_left int := p_amount;
  v_take int;
  lot record;
begin
  for lot in
    select id, remaining from public.company_credit_ledger
     where company_id = p_company_id and remaining > 0
       and (expires_at is null or expires_at > now())
     order by expires_at nulls last, created_at
     for update
  loop
    exit when v_left = 0;
    v_take := least(lot.remaining, v_left);
    update public.company_credit_ledger set remaining = remaining - v_take where id = lot.id;
    v_left := v_left - v_take;
  end loop;

  if v_left > 0 then
    raise exception 'insufficient credits for company %', p_company_id;
  end if;

  insert into public.company_credit_ledger
    (company_id, delta, reason, key, ref_type, ref_id, created_by)
  values (p_company_id, -p_amount, 'consume', p_key, p_ref_type, p_ref_id, p_actor);

  perform public.billing_refresh_credit_cache(p_company_id);
end;
$$;

-- Idempotent per (ref_type, ref_id, key). Allowance first, then credits.
-- Returns { ok, source, credits_spent, duplicate? } or { ok: false, reason, ... }.
create or replace function public.consume_entitlement(
  p_company_id uuid,
  p_key text,
  p_qty int,
  p_ref_type text,
  p_ref_id text,
  p_actor uuid default null
)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_event public.company_usage_events%rowtype;
  v_hold public.company_entitlement_holds%rowtype;
  v_check jsonb;
  v_credits int;
  v_source text;
begin
  perform public.billing_assert_key(p_key);
  if public.billing_is_limit_key(p_key) then
    raise exception 'consume_entitlement: % is a limit, not an allowance', p_key
      using errcode = 'invalid_parameter_value';
  end if;
  if p_ref_type is null or p_ref_id is null then
    raise exception 'consume_entitlement needs a reference' using errcode = 'invalid_parameter_value';
  end if;

  -- One consumer per company at a time: concurrent consumes can't both take
  -- the last unit of an allowance (BL-TEST-021).
  perform 1 from public.company_subscriptions where company_id = p_company_id for update;
  if not found then
    raise exception 'company % has no subscription', p_company_id;
  end if;

  select * into v_event from public.company_usage_events
   where ref_type = p_ref_type and ref_id = p_ref_id and key = p_key;
  if found then
    if v_event.company_id <> p_company_id then
      raise exception 'reference belongs to another company';
    end if;
    return jsonb_build_object('ok', true, 'source', v_event.source,
      'credits_spent', v_event.credits_spent, 'duplicate', true);
  end if;

  -- A hold for this ref is converted: its qty mustn't count against itself.
  delete from public.company_entitlement_holds
   where company_id = p_company_id and ref_type = p_ref_type and ref_id = p_ref_id and key = p_key
  returning * into v_hold;

  v_check := public.check_entitlement(p_company_id, p_key, p_qty);
  if not (v_check->>'allowed')::boolean then
    if v_hold.id is not null then
      insert into public.company_entitlement_holds select v_hold.*;
    end if;
    return jsonb_build_object('ok', false, 'reason', v_check->>'reason',
      'credits_needed', (v_check->>'credits_needed')::int);
  end if;

  v_credits := (v_check->>'credits_needed')::int;
  v_source := v_check->>'source';

  insert into public.company_usage (company_id, period_start, key, used)
  values (p_company_id, public.billing_period_start(p_company_id), p_key, p_qty)
  on conflict (company_id, period_start, key)
  do update set used = public.company_usage.used + excluded.used;

  if v_credits > 0 then
    perform public.billing_spend_credits(p_company_id, v_credits, p_key, p_ref_type, p_ref_id, p_actor);
  end if;

  insert into public.company_usage_events
    (company_id, key, qty, source, credits_spent, ref_type, ref_id, actor_user_id)
  values (p_company_id, p_key, p_qty, v_source, v_credits, p_ref_type, p_ref_id, p_actor);

  return jsonb_build_object('ok', true, 'source', v_source, 'credits_spent', v_credits);
end;
$$;

-- BL-REQ-006. Sets aside allowance (or credits) for committed work.
create or replace function public.hold_entitlement(
  p_company_id uuid,
  p_key text,
  p_qty int,
  p_ref_type text,
  p_ref_id text,
  p_expires_at timestamptz default null
)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_check jsonb;
  v_existing public.company_entitlement_holds%rowtype;
begin
  perform public.billing_assert_key(p_key);
  if public.billing_is_limit_key(p_key) then
    raise exception 'hold_entitlement: % is a limit, not an allowance', p_key
      using errcode = 'invalid_parameter_value';
  end if;

  perform 1 from public.company_subscriptions where company_id = p_company_id for update;
  if not found then
    raise exception 'company % has no subscription', p_company_id;
  end if;

  select * into v_existing from public.company_entitlement_holds
   where ref_type = p_ref_type and ref_id = p_ref_id and key = p_key;
  if found then
    if v_existing.company_id <> p_company_id then
      raise exception 'reference belongs to another company';
    end if;
    return jsonb_build_object('ok', true, 'existing', true);
  end if;
  if exists (select 1 from public.company_usage_events
              where ref_type = p_ref_type and ref_id = p_ref_id and key = p_key) then
    return jsonb_build_object('ok', true, 'consumed', true);
  end if;

  v_check := public.check_entitlement(p_company_id, p_key, p_qty);
  if not (v_check->>'allowed')::boolean then
    return jsonb_build_object('ok', false, 'reason', v_check->>'reason',
      'credits_needed', (v_check->>'credits_needed')::int);
  end if;

  insert into public.company_entitlement_holds (company_id, key, qty, ref_type, ref_id, expires_at)
  values (p_company_id, p_key, p_qty, p_ref_type, p_ref_id,
          coalesce(p_expires_at, now() + interval '30 days'));

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.release_hold(
  p_company_id uuid, p_ref_type text, p_ref_id text, p_key text
)
returns boolean
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.company_entitlement_holds
   where company_id = p_company_id and ref_type = p_ref_type and ref_id = p_ref_id and key = p_key;
  return found;
end;
$$;

-- Adds a credit lot. Idempotent per payment. Returns the lot id.
create or replace function public.grant_company_credits(
  p_company_id uuid,
  p_amount int,
  p_reason text,
  p_expires_at timestamptz,
  p_payment_id uuid default null,
  p_note text default null,
  p_actor uuid default null
)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_id uuid;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'credit amount must be positive' using errcode = 'invalid_parameter_value';
  end if;
  if p_reason not in ('purchase', 'grant', 'opening_balance', 'refund', 'adjust') then
    raise exception 'invalid credit reason: %', p_reason using errcode = 'invalid_parameter_value';
  end if;

  if p_payment_id is not null then
    select id into v_id from public.company_credit_ledger
     where payment_id = p_payment_id and delta > 0;
    if found then return v_id; end if;
  end if;

  insert into public.company_credit_ledger
    (company_id, delta, reason, remaining, expires_at, payment_id, note, created_by)
  values (p_company_id, p_amount, p_reason, p_amount, p_expires_at, p_payment_id, p_note, p_actor)
  returning id into v_id;

  perform public.billing_refresh_credit_cache(p_company_id);
  return v_id;
end;
$$;

-- BL-REQ-015: a manual plan (pilots, founding) until a date.
create or replace function public.set_company_plan(
  p_company_id uuid,
  p_tier_slug text,
  p_until timestamptz,
  p_actor uuid default null,
  p_note text default null
)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_tier uuid;
  v_sub public.company_subscriptions%rowtype;
begin
  select id into v_tier from public.company_tiers where slug = p_tier_slug;
  if not found then
    raise exception 'unknown plan: %', p_tier_slug using errcode = 'invalid_parameter_value';
  end if;
  if p_until is not null and p_until <= now() then
    raise exception 'plan end must be in the future' using errcode = 'invalid_parameter_value';
  end if;

  select * into v_sub from public.company_subscriptions where company_id = p_company_id for update;
  if not found then
    raise exception 'company % has no subscription', p_company_id;
  end if;
  if v_sub.dodo_subscription_id is not null and v_sub.status <> 'expired' then
    raise exception 'company % has a paid subscription; change it in Dodo', p_company_id;
  end if;

  update public.company_subscriptions set
    tier_id = v_tier,
    manual_until = p_until,
    status = 'active',
    grace_until = null,
    scheduled_tier_id = null,
    cancel_at_period_end = false,
    updated_at = now()
  where company_id = p_company_id;

  insert into public.company_billing_audit (company_id, action, details, created_by)
  values (p_company_id, 'set_plan',
          jsonb_build_object('tier', p_tier_slug, 'until', p_until, 'note', p_note,
                             'previous_tier_id', v_sub.tier_id),
          p_actor);
end;
$$;

-- Everything the billing page and the TS helpers need, for one company.
-- Members may call it for their own company; the service role for any.
create or replace function public.get_company_entitlements(p_company_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_sub public.company_subscriptions%rowtype;
  v_tier public.company_tiers%rowtype;
  v_entitlements jsonb := '{}'::jsonb;
  v_check jsonb;
  k text;
begin
  if coalesce(auth.role(), '') <> 'service_role' and not public.is_company_member(p_company_id) then
    raise exception 'not a member of company %', p_company_id using errcode = 'insufficient_privilege';
  end if;

  select * into v_sub from public.company_subscriptions where company_id = p_company_id;
  if not found then
    raise exception 'company % has no subscription', p_company_id;
  end if;
  select * into v_tier from public.company_tiers where id = public.company_effective_tier(p_company_id);

  foreach k in array array['active_job_posts', 'seats', 'profiles_per_search', 'screenings',
                           'outreach', 'interview_minutes', 'agent_messages', 'match_explanations']
  loop
    v_check := public.check_entitlement(p_company_id, k, 1);
    v_entitlements := v_entitlements || jsonb_build_object(k, jsonb_build_object(
      'kind', v_check->'kind',
      'amount', v_check->'amount',
      'used', v_check->'used',
      'held', v_check->'held',
      'remaining', v_check->'remaining',
      'overage_credits', v_check->'overage_credits'
    ));
  end loop;

  return jsonb_build_object(
    'tier_id', v_tier.id,
    'tier_slug', v_tier.slug,
    'tier_name', v_tier.name,
    'subscribed_tier_slug', (select slug from public.company_tiers where id = v_sub.tier_id),
    'status', v_sub.status,
    'billing_interval', v_sub.billing_interval,
    'currency', v_sub.currency,
    -- The usage period (monthly); renews_at is the subscription's period end.
    'period_start', public.billing_period_start(p_company_id),
    'period_end', public.billing_period_start(p_company_id) + interval '1 month',
    'renews_at', v_sub.current_period_end,
    'cancel_at_period_end', v_sub.cancel_at_period_end,
    'scheduled_tier_slug', (select slug from public.company_tiers where id = v_sub.scheduled_tier_id),
    'grace_until', v_sub.grace_until,
    'manual_until', v_sub.manual_until,
    'has_paid_subscription', v_sub.dodo_subscription_id is not null,
    'has_billing_portal', v_sub.dodo_customer_id is not null,
    'entitlements', v_entitlements,
    'credit_balance', public.billing_credit_balance(p_company_id),
    'credit_lots', coalesce((
      select jsonb_agg(jsonb_build_object('id', l.id, 'remaining', l.remaining,
               'expires_at', l.expires_at, 'reason', l.reason, 'created_at', l.created_at)
             order by l.expires_at nulls last, l.created_at)
        from public.company_credit_ledger l
       where l.company_id = p_company_id and l.remaining > 0
         and (l.expires_at is null or l.expires_at > now())
    ), '[]'::jsonb)
  );
end;
$$;

-- Daily cron (app/api/updates/billing). Returns what it did.
create or replace function public.rollover_free_periods()
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_free uuid := public.billing_free_tier_id();
  v_rolled int := 0;
  v_grants int := 0;
  v_ended int := 0;
  v_lapsed int := 0;
  v_lots int := 0;
  v_holds int := 0;
  v_start timestamptz;
  v_end timestamptz;
  v_tier uuid;
  s record;
  lot record;
  v_companies uuid[] := '{}';
begin
  -- Manual plans that ended (pilots, founding).
  update public.company_subscriptions
     set tier_id = v_free, manual_until = null, updated_at = now()
   where manual_until is not null and manual_until < now();
  get diagnostics v_grants = row_count;

  -- Grace ran out (BL-REQ-013).
  update public.company_subscriptions
     set tier_id = v_free, status = 'active', grace_until = null, updated_at = now()
   where status = 'past_due' and coalesce(grace_until, '-infinity'::timestamptz) < now();
  get diagnostics v_lapsed = row_count;

  -- Paid subscriptions that were cancelled, set to cancel, or expired, once
  -- their period is over: back to free, on our own monthly periods.
  update public.company_subscriptions
     set tier_id = v_free, status = 'active', dodo_subscription_id = null,
         billing_interval = null, cancel_at_period_end = false, scheduled_tier_id = null,
         updated_at = now()
   where current_period_end <= now()
     and (status in ('cancelled', 'expired')
          or (dodo_subscription_id is not null and cancel_at_period_end));
  get diagnostics v_ended = row_count;

  -- Subscriptions without Dodo: monthly periods, scheduled changes, cancellations.
  for s in
    select * from public.company_subscriptions
     where dodo_subscription_id is null and current_period_end <= now()
     for update
  loop
    v_start := s.current_period_start;
    v_end := s.current_period_end;
    while v_end <= now() loop
      v_start := v_end;
      v_end := v_end + interval '1 month';
    end loop;
    v_tier := case
      when s.cancel_at_period_end then v_free
      when s.scheduled_tier_id is not null then s.scheduled_tier_id
      else s.tier_id
    end;
    update public.company_subscriptions set
      current_period_start = v_start,
      current_period_end = v_end,
      tier_id = v_tier,
      scheduled_tier_id = null,
      cancel_at_period_end = false,
      updated_at = now()
    where company_id = s.company_id;
    v_rolled := v_rolled + 1;
  end loop;

  -- Lapsed credit lots.
  for lot in
    select * from public.company_credit_ledger
     where remaining > 0 and expires_at is not null and expires_at <= now()
     for update
  loop
    insert into public.company_credit_ledger (company_id, delta, reason, ref_type, ref_id)
    values (lot.company_id, -lot.remaining, 'expire', 'credit_lot', lot.id::text);
    update public.company_credit_ledger set remaining = 0 where id = lot.id;
    v_companies := array_append(v_companies, lot.company_id);
    v_lots := v_lots + 1;
  end loop;
  perform public.billing_refresh_credit_cache(c) from unnest(v_companies) as c;

  delete from public.company_entitlement_holds where expires_at <= now();
  get diagnostics v_holds = row_count;

  return jsonb_build_object(
    'rolledOver', v_rolled,
    'expiredGrants', v_grants,
    'graceEnded', v_lapsed,
    'paidEnded', v_ended,
    'expiredLots', v_lots,
    'releasedHolds', v_holds
  );
end;
$$;

-- BL-REQ-022: allowances at >= 80% / 100% this period that haven't been notified.
create or replace function public.billing_usage_alerts()
returns table (company_id uuid, key text, used int, amount int, threshold int, period_start timestamptz)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select u.company_id, u.key, u.used, e.amount,
         case when u.used >= e.amount then 100 else 80 end as threshold,
         u.period_start
    from public.company_usage u
    join public.tier_entitlements e
      on e.tier_id = public.company_effective_tier(u.company_id) and e.key = u.key
   where u.period_start = public.billing_period_start(u.company_id)
     and e.kind = 'allowance' and e.amount is not null and e.amount > 0
     and (
       (u.used >= e.amount and not u.notified_100)
       or (u.used * 100 >= e.amount * 80 and u.used < e.amount and not u.notified_80)
     )
$$;

create or replace function public.mark_usage_notified(
  p_company_id uuid, p_period_start timestamptz, p_key text, p_threshold int
)
returns void
language sql security definer
set search_path = public, pg_temp
as $$
  update public.company_usage set
    notified_80 = true,
    notified_100 = notified_100 or p_threshold >= 100
  where company_id = p_company_id and period_start = p_period_start and key = p_key
$$;

-- Keep company_info.tier_id (read by older code until phase 4) in step.
create or replace function public.sync_company_info_tier()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  update public.company_info set tier_id = new.tier_id
   where id = new.company_id and tier_id is distinct from new.tier_id;
  return new;
end;
$$;

drop trigger if exists sync_company_info_tier on public.company_subscriptions;
create trigger sync_company_info_tier
  after insert or update of tier_id on public.company_subscriptions
  for each row execute function public.sync_company_info_tier();

-- BL-DEC-007 backstop: a company can't activate a job post over its plan's
-- active_job_posts limit, even by updating the row directly. The app goes
-- through setJobPostingStatusAction, which checks first and explains the limit.
create or replace function public.billing_can_activate_job_post(p_company_id uuid)
returns boolean
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' and not public.is_company_member(p_company_id) then
    return false;
  end if;
  return (public.check_entitlement(p_company_id, 'active_job_posts', 1)->>'allowed')::boolean;
end;
$$;

-- SECURITY INVOKER so current_role is the caller's: the service role and
-- definer functions (already checked) pass through.
create or replace function public.enforce_active_job_post_limit()
returns trigger
language plpgsql security invoker
set search_path = ''
as $$
begin
  if current_role = 'authenticated'
     and new.status = 'active'
     and (tg_op = 'INSERT' or old.status is distinct from 'active')
     and not public.billing_can_activate_job_post(new.company_id) then
    raise exception 'entitlement:active_job_posts'
      using errcode = 'P0001', hint = 'Your plan''s active job post limit is reached.';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_active_job_post_limit on public.job_postings;
create trigger enforce_active_job_post_limit
  before insert or update of status on public.job_postings
  for each row execute function public.enforce_active_job_post_limit();

-- BL-REQ-001: every company has a subscription, free by default.
create or replace function public.create_default_subscription()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.company_subscriptions (company_id, tier_id)
  values (new.id, coalesce(new.tier_id, public.billing_free_tier_id()))
  on conflict (company_id) do nothing;
  return new;
end;
$$;

drop trigger if exists create_default_subscription on public.company_info;
create trigger create_default_subscription
  after insert on public.company_info
  for each row execute function public.create_default_subscription();

-- Privileges: service role only, except get_company_entitlements.
do $$
declare f text;
begin
  foreach f in array array[
    'billing_free_tier_id()', 'billing_is_limit_key(text)', 'billing_assert_key(text)',
    'company_effective_tier(uuid)', 'billing_period_start(uuid)',
    'billing_limit_used(uuid, text)', 'billing_allowance_used(uuid, text)',
    'billing_held(uuid, text)', 'billing_credit_balance(uuid)',
    'billing_refresh_credit_cache(uuid)', 'check_entitlement(uuid, text, int)',
    'billing_spend_credits(uuid, int, text, text, text, uuid)',
    'consume_entitlement(uuid, text, int, text, text, uuid)',
    'hold_entitlement(uuid, text, int, text, text, timestamptz)',
    'release_hold(uuid, text, text, text)',
    'grant_company_credits(uuid, int, text, timestamptz, uuid, text, uuid)',
    'set_company_plan(uuid, text, timestamptz, uuid, text)',
    'get_company_entitlements(uuid)', 'rollover_free_periods()',
    'billing_usage_alerts()', 'mark_usage_notified(uuid, timestamptz, text, int)',
    'sync_company_info_tier()', 'create_default_subscription()',
    'billing_can_activate_job_post(uuid)'
  ]
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

grant execute on function public.get_company_entitlements(uuid) to authenticated;
-- Called by the job_postings trigger as the caller; checks membership itself.
grant execute on function public.billing_can_activate_job_post(uuid) to authenticated;

-- ===========================================================================
-- 5. Backfill (BL-REQ-001, BL-DEC-006)
-- ===========================================================================

insert into public.company_subscriptions (company_id, tier_id)
select ci.id, coalesce(ci.tier_id, public.billing_free_tier_id())
  from public.company_info ci
on conflict (company_id) do nothing;

-- Opening balances: each company's current ai_credits, expiring in 12 months.
insert into public.company_credit_ledger
  (company_id, delta, reason, remaining, expires_at, note)
select ci.id, ci.ai_credits, 'opening_balance', ci.ai_credits, now() + interval '12 months',
       'Balance carried over at billing launch'
  from public.company_info ci
 where coalesce(ci.ai_credits, 0) > 0
   and not exists (
     select 1 from public.company_credit_ledger l
      where l.company_id = ci.id and l.reason = 'opening_balance'
   );
