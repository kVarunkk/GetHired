-- BLT-077: subscription events and company credit packs
-- (supabase/migrations/20261014160000_billing_subscriptions.sql).
-- Runs in a transaction that always rolls back:
--   npx supabase db query --linked -f supabase/tests/billing_subscriptions.sql
-- Any failed check raises an exception; success prints 'billing_subscriptions: ok'.

begin;

insert into auth.users (id, email, aud, role) values
  ('c1000000-0000-4000-8000-000000000001', 'hr@acme.test', 'authenticated', 'authenticated');
insert into public.company_info (id, user_id, name, email, ai_credits) values
  ('c0000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'Acme', 'hr@acme.test', 0);

-- Test products on Startup and Growth.
update public.company_tiers set prices = '[{"interval":"month","currency":"USD","amount_minor":4900,"dodo_product_id":"pdt_test_startup_m"}]'
 where slug = 'startup';
update public.company_tiers set prices = '[{"interval":"year","currency":"INR","amount_minor":8999000,"dodo_product_id":"pdt_test_growth_y"}]'
 where slug = 'growth';

create temp table ids as select
  'c0000000-0000-4000-8000-000000000001'::uuid as a,
  (select id from public.company_tiers where slug = 'free') as free,
  (select id from public.company_tiers where slug = 'startup') as startup,
  (select id from public.company_tiers where slug = 'growth') as growth;
grant select on ids to authenticated;

-- ---------------------------------------------------------------- company credit pack
insert into public.payments (id, status, kind, company_id, price_plan_id) values
  ('9b000000-0000-4000-8000-0000000000d1', 'pending', 'company_credits', 'c0000000-0000-4000-8000-000000000001',
   (select id from public.price_plan where audience = 'company' and credit_amount = 500)),
  ('9b000000-0000-4000-8000-0000000000d2', 'pending', 'company_subscription', 'c0000000-0000-4000-8000-000000000001', null);

do $$
declare i ids; r jsonb;
begin
  select * into i from ids;
  r := public.fulfil_payment('9b000000-0000-4000-8000-0000000000d1', 'wh_sub_1', 'pay_c1');
  assert r->>'status' = 'fulfilled' and r->>'kind' = 'company_credits' and (r->>'credit_amount')::int = 500,
    format('company pack: %s', r);
  assert public.billing_credit_balance(i.a) = 500, 'credits granted';
  assert (select expires_at > now() + interval '11 months' from public.company_credit_ledger
           where payment_id = '9b000000-0000-4000-8000-0000000000d1'), 'purchased credits expire in 12 months';

  r := public.fulfil_payment('9b000000-0000-4000-8000-0000000000d1', 'wh_sub_2', 'pay_c1');
  assert r->>'status' = 'already_fulfilled', format('twice: %s', r);
  assert public.billing_credit_balance(i.a) = 500, 'granted twice';

  r := public.fulfil_payment('9b000000-0000-4000-8000-0000000000d2', 'wh_sub_3', 'pay_s1');
  assert r->>'status' = 'recorded', format('subscription payment: %s', r);
  assert (select status from public.payments where id = '9b000000-0000-4000-8000-0000000000d2') = 'complete',
    'subscription payment recorded';
  assert public.billing_credit_balance(i.a) = 500, 'subscription payment granted credits';
end $$;

-- ---------------------------------------------------------------- §4.2
do $$
declare i ids; r jsonb; s public.company_subscriptions%rowtype;
begin
  select * into i from ids;

  -- An event for a subscription the company doesn't have.
  begin
    perform public.apply_subscription_event(i.a, '{"type":"subscription.renewed","subscription_id":"sub_nope"}');
    raise exception 'applied an event for an unknown subscription';
  exception when no_data_found then null;
  end;

  -- active: the tier from our payment row, not the product.
  r := public.apply_subscription_event(i.a, jsonb_build_object(
    'type', 'subscription.active', 'subscription_id', 'sub_1', 'customer_id', 'cus_1',
    'product_id', 'pdt_test_growth_y', 'tier_id', i.startup,
    'period_start', now() - interval '1 day', 'period_end', now() + interval '29 days'));
  select * into s from public.company_subscriptions where company_id = i.a;
  assert s.tier_id = i.startup and s.status = 'active' and s.dodo_subscription_id = 'sub_1'
     and s.dodo_customer_id = 'cus_1' and s.grace_until is null, format('active: %s', to_jsonb(s));
  assert r->>'previous_tier_id' = i.free::text, format('previous tier: %s', r);

  -- plan_changed: the new product's tier; period and usage kept.
  perform public.consume_entitlement(i.a, 'screenings', 7, 'test', 'scr-1');
  r := public.apply_subscription_event(i.a, '{"type":"subscription.plan_changed","subscription_id":"sub_1","product_id":"pdt_test_growth_y"}');
  select * into s from public.company_subscriptions where company_id = i.a;
  assert s.tier_id = i.growth and s.billing_interval = 'year' and s.currency = 'INR', format('plan_changed: %s', to_jsonb(s));
  assert public.billing_allowance_used(i.a, 'screenings') = 7, 'usage carried over';

  -- on_hold: past_due with 7 days of grace; a second failure doesn't extend it.
  perform public.apply_subscription_event(i.a, '{"type":"subscription.on_hold","subscription_id":"sub_1"}');
  select * into s from public.company_subscriptions where company_id = i.a;
  assert s.status = 'past_due' and s.grace_until between now() + interval '6 days 23 hours' and now() + interval '7 days 1 minute',
    format('on_hold: %s', to_jsonb(s));
  update public.company_subscriptions set grace_until = now() + interval '2 days' where company_id = i.a;
  perform public.apply_subscription_event(i.a, '{"type":"subscription.failed","subscription_id":"sub_1"}');
  assert (select grace_until < now() + interval '3 days' from public.company_subscriptions where company_id = i.a),
    'grace extended by a second failure';

  -- renewed: a new period, active again, and a scheduled downgrade applies.
  perform public.schedule_company_plan_change(i.a, 'startup');
  perform public.apply_subscription_event(i.a, jsonb_build_object(
    'type', 'subscription.renewed', 'subscription_id', 'sub_1',
    'period_start', now(), 'period_end', now() + interval '1 year'));
  select * into s from public.company_subscriptions where company_id = i.a;
  assert s.status = 'active' and s.grace_until is null and s.tier_id = i.startup and s.scheduled_tier_id is null,
    format('renewed: %s', to_jsonb(s));
  assert public.billing_allowance_used(i.a, 'screenings') = 0, 'a new period starts at 0';

  -- cancelled: at the period end.
  perform public.apply_subscription_event(i.a, '{"type":"subscription.cancelled","subscription_id":"sub_1"}');
  select * into s from public.company_subscriptions where company_id = i.a;
  assert s.cancel_at_period_end and s.status = 'active', format('cancelled: %s', to_jsonb(s));
  assert public.company_effective_tier(i.a) = i.startup, 'plan kept until the period ends';

  -- updated: a resume clears the flag.
  perform public.apply_subscription_event(i.a, '{"type":"subscription.updated","subscription_id":"sub_1","cancel_at_next_billing_date":false}');
  assert not (select cancel_at_period_end from public.company_subscriptions where company_id = i.a), 'resumed';

  -- The cron moves a subscription that was set to cancel to free when its period ends.
  update public.company_subscriptions set cancel_at_period_end = true, current_period_end = now() - interval '1 minute'
   where company_id = i.a;
  perform public.rollover_free_periods();
  select * into s from public.company_subscriptions where company_id = i.a;
  assert s.tier_id = i.free and s.dodo_subscription_id is null and not s.cancel_at_period_end,
    format('cancel at period end applied: %s', to_jsonb(s));

  -- expired: free straight away.
  update public.company_subscriptions set dodo_subscription_id = 'sub_2', tier_id = i.growth,
    current_period_end = now() + interval '10 days' where company_id = i.a;
  perform public.apply_subscription_event(i.a, '{"type":"subscription.expired","subscription_id":"sub_2"}');
  assert (select status from public.company_subscriptions where company_id = i.a) = 'expired', 'expired';
  assert public.company_effective_tier(i.a) = i.free, 'expired is free';
end $$;

-- ---------------------------------------------------------------- privileges
select set_config('request.jwt.claims', '{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
do $$
declare i ids;
begin
  select * into i from ids;
  begin
    perform public.apply_subscription_event(i.a, '{"type":"subscription.active","subscription_id":"x","product_id":"pdt_test_growth_y"}');
    raise exception 'a company applied a subscription event';
  exception when insufficient_privilege then null;
  end;
  assert not exists (select 1 from public.price_plan where audience = 'company'), 'users see company packs';
  assert exists (select 1 from public.price_plan where audience = 'applicant'), 'users can''t see applicant packs';
  begin
    perform public.schedule_company_plan_change(i.a, null);
    raise exception 'a company scheduled a plan change';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

select 'billing_subscriptions: ok' as result;

rollback;
