-- Self-serve company payments (plan/recruiter-billing/feature-recruiter-billing-spec.md §4.2, BL-TASK-021).
--
-- 1. fulfil_payment also fulfils company credit packs and records subscription payments.
-- 2. apply_subscription_event maps Dodo subscription events onto company_subscriptions.
-- 3. set_company_cancel_at_period_end and schedule_company_plan_change for the
--    plan actions.
-- 4. The company credit packs (§5.1) in price_plan, without Dodo product ids;
--    scripts/billing-dodo-products.ts creates the products and fills them in.
-- Idempotent: safe to run twice.

-- ---------------------------------------------------------------------------
-- 1. fulfil_payment
-- ---------------------------------------------------------------------------

create or replace function public.fulfil_payment(
  p_payment_row_id uuid,
  p_webhook_id text,
  p_dodo_payment_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_payment public.payments%rowtype;
  v_credits integer;
begin
  select * into v_payment from public.payments where id = p_payment_row_id for update;

  if not found then
    raise exception 'payment % not found', p_payment_row_id using errcode = 'no_data_found';
  end if;

  if v_payment.credits_fulfilled or (v_payment.kind = 'company_subscription' and v_payment.status = 'complete') then
    return jsonb_build_object(
      'status', 'already_fulfilled',
      'kind', v_payment.kind,
      'user_id', v_payment.user_id,
      'company_id', v_payment.company_id,
      'credit_amount', v_payment.credit_amount
    );
  end if;

  if v_payment.kind = 'company_subscription' then
    -- The subscription events drive plan state; this only records the payment.
    update public.payments
       set status = 'complete',
           payment_id = coalesce(p_dodo_payment_id, payment_id),
           updated_at = now()
     where id = p_payment_row_id;
    update public.billing_webhook_events set processed_at = now(), error = null
     where webhook_id = p_webhook_id;
    return jsonb_build_object('status', 'recorded', 'kind', v_payment.kind,
                              'company_id', v_payment.company_id);
  end if;

  select pp.credit_amount into v_credits
    from public.price_plan pp
   where pp.id = v_payment.price_plan_id
     and pp.audience = case when v_payment.kind = 'company_credits' then 'company' else 'applicant' end;

  if v_credits is null or v_credits <= 0 then
    raise exception 'payment % has no % price plan', p_payment_row_id, v_payment.kind;
  end if;

  if v_payment.kind = 'company_credits' then
    if v_payment.company_id is null then
      raise exception 'company payment % has no company', p_payment_row_id;
    end if;
    -- BL-REQ-004: purchased credits expire after 12 months. Idempotent per payment.
    perform public.grant_company_credits(
      v_payment.company_id, v_credits, 'purchase', now() + interval '12 months',
      v_payment.id, null, null);
  else
    update public.user_info
       set ai_credits = coalesce(ai_credits, 0) + v_credits,
           updated_at = now()
     where user_id = v_payment.user_id;

    if not found then
      raise exception 'user % for payment % not found', v_payment.user_id, p_payment_row_id;
    end if;
  end if;

  update public.payments
     set status = 'complete',
         credits_fulfilled = true,
         credit_amount = v_credits,
         payment_id = coalesce(p_dodo_payment_id, payment_id),
         fulfillment_date = now(),
         updated_at = now()
   where id = p_payment_row_id;

  update public.billing_webhook_events
     set processed_at = now(), error = null
   where webhook_id = p_webhook_id;

  return jsonb_build_object(
    'status', 'fulfilled',
    'kind', v_payment.kind,
    'user_id', v_payment.user_id,
    'company_id', v_payment.company_id,
    'credit_amount', v_credits
  );
end;
$$;

revoke all on function public.fulfil_payment(uuid, text, text) from public, anon, authenticated;
grant execute on function public.fulfil_payment(uuid, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 2. Subscription events
-- ---------------------------------------------------------------------------

-- The tier, interval and currency a Dodo product sells (company_tiers.prices).
create or replace function public.billing_tier_for_product(p_product_id text)
returns table (tier_id uuid, billing_interval text, currency text)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select t.id, p->>'interval', p->>'currency'
    from public.company_tiers t, jsonb_array_elements(t.prices) p
   where p->>'dodo_product_id' = p_product_id
   limit 1
$$;

-- p_event (built by the webhook from the Dodo payload):
--   { type, subscription_id, customer_id, product_id, period_start, period_end,
--     cancel_at_next_billing_date, tier_id (subscription.active: from our payment row) }
-- Returns { previous_tier_id, tier_id, status, scheduled }.
create or replace function public.apply_subscription_event(p_company_id uuid, p_event jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_sub public.company_subscriptions%rowtype;
  v_type text := p_event->>'type';
  v_sub_id text := p_event->>'subscription_id';
  v_product record;
  v_tier uuid;
  v_start timestamptz := nullif(p_event->>'period_start', '')::timestamptz;
  v_end timestamptz := nullif(p_event->>'period_end', '')::timestamptz;
  v_previous uuid;
begin
  select * into v_sub from public.company_subscriptions where company_id = p_company_id for update;
  if not found then
    raise exception 'company % has no subscription', p_company_id;
  end if;
  v_previous := v_sub.tier_id;

  if v_type <> 'subscription.active'
     and v_sub.dodo_subscription_id is distinct from v_sub_id then
    raise exception 'subscription % is not company %''s', v_sub_id, p_company_id
      using errcode = 'no_data_found';
  end if;

  select * into v_product from public.billing_tier_for_product(p_event->>'product_id');

  case v_type
    when 'subscription.active' then
      v_tier := coalesce(nullif(p_event->>'tier_id', '')::uuid, v_product.tier_id);
      if v_tier is null then
        raise exception 'no tier for product %', p_event->>'product_id';
      end if;
      update public.company_subscriptions set
        tier_id = v_tier,
        status = 'active',
        dodo_subscription_id = v_sub_id,
        dodo_customer_id = coalesce(p_event->>'customer_id', dodo_customer_id),
        billing_interval = coalesce(v_product.billing_interval, billing_interval),
        currency = coalesce(v_product.currency, currency),
        current_period_start = coalesce(v_start, current_period_start),
        current_period_end = coalesce(v_end, current_period_end),
        cancel_at_period_end = coalesce((p_event->>'cancel_at_next_billing_date')::boolean, false),
        grace_until = null,
        manual_until = null,
        scheduled_tier_id = null,
        updated_at = now()
      where company_id = p_company_id;

    when 'subscription.renewed' then
      update public.company_subscriptions set
        status = 'active',
        grace_until = null,
        current_period_start = coalesce(v_start, current_period_start),
        current_period_end = coalesce(v_end, current_period_end),
        tier_id = coalesce(scheduled_tier_id, tier_id),
        scheduled_tier_id = null,
        updated_at = now()
      where company_id = p_company_id;

    when 'subscription.plan_changed' then
      if v_product.tier_id is null then
        raise exception 'no tier for product %', p_event->>'product_id';
      end if;
      update public.company_subscriptions set
        tier_id = v_product.tier_id,
        billing_interval = coalesce(v_product.billing_interval, billing_interval),
        currency = coalesce(v_product.currency, currency),
        scheduled_tier_id = case when scheduled_tier_id = v_product.tier_id then null else scheduled_tier_id end,
        updated_at = now()
      where company_id = p_company_id;

    when 'subscription.on_hold', 'subscription.failed' then
      update public.company_subscriptions set
        status = 'past_due',
        -- Repeated failures don't extend the grace period.
        grace_until = coalesce(grace_until, now() + interval '7 days'),
        updated_at = now()
      where company_id = p_company_id;

    when 'subscription.cancelled' then
      update public.company_subscriptions set
        cancel_at_period_end = true,
        status = case when current_period_end <= now() then 'cancelled' else status end,
        updated_at = now()
      where company_id = p_company_id;

    when 'subscription.expired' then
      update public.company_subscriptions set status = 'expired', updated_at = now()
       where company_id = p_company_id;

    when 'subscription.updated' then
      update public.company_subscriptions set
        cancel_at_period_end = coalesce((p_event->>'cancel_at_next_billing_date')::boolean, cancel_at_period_end),
        current_period_end = coalesce(v_end, current_period_end),
        updated_at = now()
      where company_id = p_company_id;

    else
      return jsonb_build_object('ignored', true);
  end case;

  select * into v_sub from public.company_subscriptions where company_id = p_company_id;
  return jsonb_build_object(
    'previous_tier_id', v_previous,
    'tier_id', v_sub.tier_id,
    'status', v_sub.status,
    'cancel_at_period_end', v_sub.cancel_at_period_end
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Plan actions (the Dodo call is made by the server action first)
-- ---------------------------------------------------------------------------

create or replace function public.set_company_cancel_at_period_end(p_company_id uuid, p_cancel boolean)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  update public.company_subscriptions
     set cancel_at_period_end = p_cancel, updated_at = now()
   where company_id = p_company_id;
  if not found then
    raise exception 'company % has no subscription', p_company_id;
  end if;
end;
$$;

-- A downgrade at the period end (null clears it).
create or replace function public.schedule_company_plan_change(p_company_id uuid, p_tier_slug text)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_tier uuid;
begin
  if p_tier_slug is not null then
    select id into v_tier from public.company_tiers where slug = p_tier_slug;
    if not found then
      raise exception 'unknown plan: %', p_tier_slug using errcode = 'invalid_parameter_value';
    end if;
  end if;
  update public.company_subscriptions
     set scheduled_tier_id = v_tier, updated_at = now()
   where company_id = p_company_id;
  if not found then
    raise exception 'company % has no subscription', p_company_id;
  end if;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'billing_tier_for_product(text)',
    'apply_subscription_event(uuid, jsonb)',
    'set_company_cancel_at_period_end(uuid, boolean)',
    'schedule_company_plan_change(uuid, text)'
  ]
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Company credit packs (§5.1). Product ids are filled in per environment.
-- ---------------------------------------------------------------------------

-- Users only see applicant packs: the applicant buy-credits page lists every
-- row it can read. Company packs are read with the service role (billing page,
-- checkout route).
drop policy if exists "Allow authenticated users to SELECT" on public.price_plan;
drop policy if exists "Users can read applicant packs" on public.price_plan;
create policy "Users can read applicant packs"
  on public.price_plan for select to authenticated
  using (audience = 'applicant');

insert into public.price_plan (name, description, credit_amount, amount, currency, audience)
select v.name, v.description, v.credits, v.amount, '$', 'company'
  from (values
    ('100 company credits', 'Top up for overage on any plan.', 100, 10),
    ('500 company credits', 'For a busy hiring month.', 500, 45),
    ('2,000 company credits', 'Best value per credit.', 2000, 160)
  ) as v(name, description, credits, amount)
 where not exists (
   select 1 from public.price_plan p where p.audience = 'company' and p.name = v.name
 );
