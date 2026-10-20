-- BL-TEST-020: applicant payment fixes (supabase/migrations/20261014140000_billing_fixes.sql).
-- Runs in a transaction that always rolls back:
--   npx supabase db query --linked -f supabase/tests/billing_fixes.sql
-- Any failed check raises an exception; success prints 'billing_fixes: ok'.
--
-- Concurrency (BL-F02) can't be shown inside one rolled-back transaction, so
-- run it by hand on a branch or local DB with two psql sessions:
--   1. Seed a pending payment as below, and commit.
--   2. Session 1: begin; select public.fulfil_payment('<row>', 'wh_a', 'pay_1');  (don't commit)
--   3. Session 2: select public.fulfil_payment('<row>', 'wh_b', 'pay_1');         (blocks on the row lock)
--   4. Session 1: commit;  Session 2 returns {"status": "already_fulfilled"}.
--   5. user_info.ai_credits went up by the plan's credit_amount exactly once.

begin;

insert into auth.users (id, email, aud, role) values
  ('a0000000-0000-4000-8000-0000000000b1', 'buyer@applicant.test', 'authenticated', 'authenticated');

insert into public.user_info (user_id, email, full_name, filled, ai_credits) values
  ('a0000000-0000-4000-8000-0000000000b1', 'buyer@applicant.test', 'Buyer', true, 10);

insert into public.price_plan (id, name, credit_amount, amount, currency, product_id, audience) values
  ('9a000000-0000-4000-8000-0000000000b1', 'Test pack', 50, 5, '$', 'pdt_test_applicant', 'applicant'),
  ('9a000000-0000-4000-8000-0000000000b2', 'Company pack', 100, 10, '$', 'pdt_test_company', 'company');

-- The payload claims 30000 credits; the row and the plan say 50.
insert into public.payments (id, user_id, price_plan_id, product_id, credit_amount, status) values
  ('9b000000-0000-4000-8000-0000000000b1', 'a0000000-0000-4000-8000-0000000000b1',
   '9a000000-0000-4000-8000-0000000000b1', 'pdt_test_applicant', 30000, 'pending'),
  ('9b000000-0000-4000-8000-0000000000b2', 'a0000000-0000-4000-8000-0000000000b1',
   '9a000000-0000-4000-8000-0000000000b2', 'pdt_test_company', 100, 'pending');

insert into public.billing_webhook_events (webhook_id, event_type, payload) values
  ('wh_test_b1', 'payment.succeeded', '{}');

-- ---------------------------------------------------------------- fulfilment
-- As the webhook calls it. Also shows the live user_info guard
-- (prevent_ai_credits_update, BL-ASSUMPTION-002) lets the definer through.
set local role service_role;

do $$
declare
  r jsonb;
  p public.payments%rowtype;
begin
  r := public.fulfil_payment('9b000000-0000-4000-8000-0000000000b1', 'wh_test_b1', 'pay_test_1');
  assert r->>'status' = 'fulfilled', format('first call: %s', r);
  assert (r->>'credit_amount')::int = 50, format('credit amount: %s', r);

  -- Credits come from price_plan (50), not the payments row or a payload (30000).
  assert (select ai_credits from public.user_info where user_id = 'a0000000-0000-4000-8000-0000000000b1') = 60,
    'ai_credits after fulfilment';

  select * into p from public.payments where id = '9b000000-0000-4000-8000-0000000000b1';
  assert p.status = 'complete' and p.credits_fulfilled and p.payment_id = 'pay_test_1'
     and p.credit_amount = 50 and p.fulfillment_date is not null,
    format('payment row: %s', to_jsonb(p));

  assert (select processed_at is not null from public.billing_webhook_events where webhook_id = 'wh_test_b1'),
    'webhook event marked processed';

  -- A second delivery (or a second event for the same payment) is a no-op.
  r := public.fulfil_payment('9b000000-0000-4000-8000-0000000000b1', 'wh_test_b2', 'pay_test_1');
  assert r->>'status' = 'already_fulfilled', format('second call: %s', r);
  assert (select ai_credits from public.user_info where user_id = 'a0000000-0000-4000-8000-0000000000b1') = 60,
    'credits granted twice';
end $$;

-- A company pack is never fulfilled as applicant credits.
do $$
begin
  begin
    perform public.fulfil_payment('9b000000-0000-4000-8000-0000000000b2', 'wh_test_b3', 'pay_test_2');
    raise exception 'fulfilled a company price plan for an applicant';
  exception when raise_exception then
    if sqlerrm like 'fulfilled a company%' then raise; end if;
  end;
  assert (select ai_credits from public.user_info where user_id = 'a0000000-0000-4000-8000-0000000000b1') = 60,
    'company pack changed ai_credits';
end $$;

-- An unknown payment row raises.
do $$
begin
  begin
    perform public.fulfil_payment('9b000000-0000-4000-8000-0000000000ff', 'wh_test_b4', null);
    raise exception 'fulfilled an unknown payment';
  exception when no_data_found then null;
  end;
end $$;

reset role;

-- ---------------------------------------------------------------- BL-F04
do $$
begin
  update public.user_info set ai_credits = 40000 where user_id = 'a0000000-0000-4000-8000-0000000000b1';
  assert (select ai_credits from public.user_info where user_id = 'a0000000-0000-4000-8000-0000000000b1') = 40000,
    'user_info.ai_credits above smallint';
  assert (select data_type from information_schema.columns
           where table_schema = 'public' and table_name = 'company_info' and column_name = 'ai_credits') = 'integer',
    'company_info.ai_credits type';
end $$;

-- ---------------------------------------------------------------- privileges
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;

do $$
begin
  begin
    perform public.fulfil_payment('9b000000-0000-4000-8000-0000000000b2', 'wh_test_b5', null);
    raise exception 'authenticated executed fulfil_payment';
  exception when insufficient_privilege then null;
  end;

  begin
    update public.price_plan set credit_amount = 999 where id = '9a000000-0000-4000-8000-0000000000b1';
    raise exception 'authenticated updated price_plan';
  exception when insufficient_privilege then null;
  end;

  begin
    perform 1 from public.billing_webhook_events;
    raise exception 'authenticated read billing_webhook_events';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
select 'billing_fixes: ok' as result;

rollback;
