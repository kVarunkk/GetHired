-- BL-TEST-021 to BL-TEST-024: company billing (supabase/migrations/20261014150000_company_billing.sql).
-- Runs in a transaction that always rolls back:
--   npx supabase db query --linked -f supabase/tests/company_billing.sql
-- Any failed check raises an exception; success prints 'company_billing: ok'.
-- Company ids match test/utils/recruiter.ts.
--
-- Concurrency (BL-TEST-021) needs two sessions, so run it by hand on a branch
-- or local DB:
--   1. Commit a company on Free with screenings used = 49 (one unit left).
--   2. Session 1: begin; select consume_entitlement('<company>', 'screenings', 1, 't', 'r1');
--   3. Session 2: select consume_entitlement('<company>', 'screenings', 1, 't', 'r2');
--      (blocks on the company_subscriptions row lock)
--   4. Session 1: commit;  Session 2 returns {"ok": false, "reason": "limit_reached"}.
--   5. company_usage.used = 50, never 51.

begin;

insert into auth.users (id, email, aud, role) values
  ('c1000000-0000-4000-8000-000000000001', 'hr@acme.test', 'authenticated', 'authenticated'),
  ('c1000000-0000-4000-8000-000000000002', 'hr@globex.test', 'authenticated', 'authenticated');

insert into public.company_info (id, user_id, name, email, ai_credits) values
  ('c0000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'Acme', 'hr@acme.test', 0),
  ('c0000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000002', 'Globex', 'hr@globex.test', 0);

create temp table ids as select
  'c0000000-0000-4000-8000-000000000001'::uuid as a,
  'c0000000-0000-4000-8000-000000000002'::uuid as b,
  (select id from public.company_tiers where slug = 'free') as free,
  (select id from public.company_tiers where slug = 'startup') as startup,
  (select id from public.company_tiers where slug = 'enterprise') as enterprise;
grant select on ids to authenticated, anon;

-- ---------------------------------------------------------------- default subscription (BL-REQ-001)
do $$
declare i ids;
begin
  select * into i from ids;
  assert (select tier_id from public.company_subscriptions where company_id = i.a) = i.free, 'A on free';
  assert (select tier_id from public.company_subscriptions where company_id = i.b) = i.free, 'B on free';
  assert not exists (select 1 from public.company_info ci
                      where not exists (select 1 from public.company_subscriptions s where s.company_id = ci.id)),
    'a company without a subscription';
end $$;

-- ---------------------------------------------------------------- company_effective_tier (BL-TEST-024)
do $$
declare i ids;
begin
  select * into i from ids;
  update public.company_subscriptions set tier_id = i.startup where company_id = i.a;
  assert public.company_effective_tier(i.a) = i.startup, 'active';
  assert (select tier_id from public.company_info where id = i.a) = i.startup, 'company_info.tier_id synced';

  update public.company_subscriptions set status = 'past_due', grace_until = now() + interval '2 days' where company_id = i.a;
  assert public.company_effective_tier(i.a) = i.startup, 'past_due within grace';
  update public.company_subscriptions set grace_until = now() - interval '1 minute' where company_id = i.a;
  assert public.company_effective_tier(i.a) = i.free, 'past_due after grace';

  update public.company_subscriptions set status = 'cancelled', grace_until = null where company_id = i.a;
  assert public.company_effective_tier(i.a) = i.free, 'cancelled';
  update public.company_subscriptions set status = 'expired' where company_id = i.a;
  assert public.company_effective_tier(i.a) = i.free, 'expired';

  update public.company_subscriptions set status = 'active', manual_until = now() - interval '1 minute' where company_id = i.a;
  assert public.company_effective_tier(i.a) = i.free, 'manual_until passed';
  update public.company_subscriptions set manual_until = now() + interval '1 day' where company_id = i.a;
  assert public.company_effective_tier(i.a) = i.startup, 'manual_until ahead';

  update public.company_subscriptions set tier_id = i.free, manual_until = null where company_id = i.a;
end $$;

-- ---------------------------------------------------------------- limits
insert into public.all_jobs (id, job_name, job_url, company_name, platform) values
  ('d0000000-0000-4000-8000-0000000000c1', 'A1', 'https://acme.test/1', 'Acme', 'gethired'),
  ('d0000000-0000-4000-8000-0000000000c2', 'A2', 'https://acme.test/2', 'Acme', 'gethired'),
  ('d0000000-0000-4000-8000-0000000000c3', 'A3', 'https://acme.test/3', 'Acme', 'gethired');
insert into public.job_postings (company_id, title, job_id, status) values
  ('c0000000-0000-4000-8000-000000000001', 'A1', 'd0000000-0000-4000-8000-0000000000c1', 'active'),
  ('c0000000-0000-4000-8000-000000000001', 'A2', 'd0000000-0000-4000-8000-0000000000c2', 'active'),
  ('c0000000-0000-4000-8000-000000000001', 'A3', 'd0000000-0000-4000-8000-0000000000c3', 'inactive');

do $$
declare i ids; r jsonb;
begin
  select * into i from ids;
  r := public.check_entitlement(i.a, 'active_job_posts', 1);
  assert not (r->>'allowed')::boolean and r->>'reason' = 'limit_reached' and (r->>'used')::int = 2,
    format('2 active posts on Free: %s', r);
  assert r->>'source' is null, 'a limit never returns credits';

  r := public.check_entitlement(i.b, 'active_job_posts', 1);
  assert (r->>'allowed')::boolean and (r->>'used')::int = 0, format('B has room: %s', r);

  r := public.check_entitlement(i.a, 'seats', 1);
  assert (r->>'allowed')::boolean and (r->>'used')::int = 1, format('seats: owner only: %s', r);
  r := public.check_entitlement(i.a, 'seats', 2);
  assert not (r->>'allowed')::boolean, format('seats over: %s', r);

  r := public.check_entitlement(i.a, 'profiles_per_search', 1);
  assert (r->>'allowed')::boolean and (r->>'amount')::int = 20, format('profiles_per_search: %s', r);

  update public.company_subscriptions set tier_id = i.enterprise where company_id = i.a;
  r := public.check_entitlement(i.a, 'active_job_posts', 1);
  assert (r->>'allowed')::boolean and r->'amount' = 'null'::jsonb, format('unlimited: %s', r);
  update public.company_subscriptions set tier_id = i.free where company_id = i.a;

  begin
    perform public.consume_entitlement(i.a, 'active_job_posts', 1, 't', 'limit-1');
    raise exception 'consumed a limit key';
  exception when invalid_parameter_value then null;
  end;
end $$;

-- ---------------------------------------------------------------- consume (BL-TEST-021)
do $$
declare i ids; r jsonb; lot_late uuid; lot_soon uuid;
begin
  select * into i from ids;

  -- Hard stop: Free screenings, 50.
  r := public.consume_entitlement(i.a, 'screenings', 50, 'test', 'scr-1');
  assert (r->>'ok')::boolean and r->>'source' = 'allowance', format('first 50: %s', r);
  r := public.consume_entitlement(i.a, 'screenings', 1, 'test', 'scr-2');
  assert not (r->>'ok')::boolean and r->>'reason' = 'limit_reached', format('51st: %s', r);
  assert public.billing_allowance_used(i.a, 'screenings') = 50, 'nothing written on failure';

  -- Same ref twice charges once.
  r := public.consume_entitlement(i.a, 'screenings', 50, 'test', 'scr-1');
  assert (r->>'ok')::boolean and (r->>'duplicate')::boolean, format('duplicate: %s', r);
  assert public.billing_allowance_used(i.a, 'screenings') = 50, 'charged twice';
  assert (select count(*) from public.company_usage_events where company_id = i.a and key = 'screenings') = 1,
    'one usage event';

  -- Overage: Free interview_minutes, 30 with 1 credit per minute. No credits yet.
  r := public.consume_entitlement(i.a, 'interview_minutes', 31, 'test', 'iv-1');
  assert not (r->>'ok')::boolean and r->>'reason' = 'insufficient_credits', format('no credits: %s', r);
  assert public.billing_allowance_used(i.a, 'interview_minutes') = 0, 'nothing written';

  -- Credits FIFO by expiry; an expired lot isn't spent.
  lot_late := public.grant_company_credits(i.a, 5, 'grant', now() + interval '10 days');
  lot_soon := public.grant_company_credits(i.a, 5, 'grant', now() + interval '5 days');
  insert into public.company_credit_ledger (company_id, delta, reason, remaining, expires_at)
  values (i.a, 100, 'grant', 100, now() - interval '1 day');
  assert public.billing_credit_balance(i.a) = 10, 'expired lot not in the balance';
  assert (select ai_credits from public.company_info where id = i.a) = 10, 'cached balance';

  r := public.consume_entitlement(i.a, 'interview_minutes', 33, 'test', 'iv-1');
  assert (r->>'ok')::boolean and r->>'source' = 'mixed' and (r->>'credits_spent')::int = 3,
    format('30 allowance + 3 credits: %s', r);
  assert (select remaining from public.company_credit_ledger where id = lot_soon) = 2, 'soonest lot spent first';
  assert (select remaining from public.company_credit_ledger where id = lot_late) = 5, 'later lot untouched';
  assert (select ai_credits from public.company_info where id = i.a) = 7, 'cache after spend';
  assert exists (select 1 from public.company_credit_ledger
                  where company_id = i.a and reason = 'consume' and delta = -3 and ref_id = 'iv-1'),
    'consume row';

  r := public.consume_entitlement(i.a, 'interview_minutes', 2, 'test', 'iv-2');
  assert (r->>'ok')::boolean and r->>'source' = 'credits' and (r->>'credits_spent')::int = 2,
    format('all credits: %s', r);

  r := public.check_entitlement(i.a, 'interview_minutes', 6);
  assert not (r->>'allowed')::boolean and r->>'reason' = 'insufficient_credits'
     and (r->>'credits_needed')::int = 6, format('5 left, 6 needed: %s', r);
end $$;

-- ---------------------------------------------------------------- holds (BL-TEST-022)
do $$
declare i ids; r jsonb;
begin
  select * into i from ids;
  -- B: Free interview_minutes 30, no credits.
  r := public.hold_entitlement(i.b, 'interview_minutes', 20, 'interview_invite', 'inv-1');
  assert (r->>'ok')::boolean, format('hold 20: %s', r);
  r := public.check_entitlement(i.b, 'interview_minutes', 1);
  assert (r->>'remaining')::int = 10 and (r->>'held')::int = 20, format('hold counts: %s', r);

  r := public.hold_entitlement(i.b, 'interview_minutes', 15, 'interview_invite', 'inv-2');
  assert not (r->>'ok')::boolean and r->>'reason' = 'insufficient_credits', format('hold that does not fit: %s', r);

  r := public.hold_entitlement(i.b, 'interview_minutes', 20, 'interview_invite', 'inv-1');
  assert (r->>'ok')::boolean and (r->>'existing')::boolean, format('same hold twice: %s', r);

  r := public.consume_entitlement(i.b, 'interview_minutes', 20, 'interview_invite', 'inv-1');
  assert (r->>'ok')::boolean and r->>'source' = 'allowance', format('convert hold: %s', r);
  assert public.billing_held(i.b, 'interview_minutes') = 0, 'hold converted';
  assert public.billing_allowance_used(i.b, 'interview_minutes') = 20, 'no double count';

  r := public.hold_entitlement(i.b, 'interview_minutes', 10, 'interview_invite', 'inv-3');
  assert (r->>'ok')::boolean, format('hold the rest: %s', r);
  assert public.release_hold(i.b, 'interview_invite', 'inv-3', 'interview_minutes'), 'release';
  assert public.billing_held(i.b, 'interview_minutes') = 0, 'released';

  begin
    perform public.hold_entitlement(i.b, 'seats', 1, 't', 'seat-1');
    raise exception 'held a limit key';
  exception when invalid_parameter_value then null;
  end;
end $$;

-- ---------------------------------------------------------------- grant_company_credits
insert into public.payments (id, status, kind, company_id) values
  ('9b000000-0000-4000-8000-0000000000c1', 'pending', 'company_credits', 'c0000000-0000-4000-8000-000000000002');

do $$
declare i ids; l1 uuid; l2 uuid;
begin
  select * into i from ids;
  l1 := public.grant_company_credits(i.b, 100, 'purchase', now() + interval '12 months',
                                     '9b000000-0000-4000-8000-0000000000c1');
  l2 := public.grant_company_credits(i.b, 100, 'purchase', now() + interval '12 months',
                                     '9b000000-0000-4000-8000-0000000000c1');
  assert l1 = l2, 'idempotent per payment';
  assert public.billing_credit_balance(i.b) = 100, 'granted once';
  assert (select ai_credits from public.company_info where id = i.b) = 100, 'cache after grant';
end $$;

-- ---------------------------------------------------------------- set_company_plan
do $$
declare i ids;
begin
  select * into i from ids;
  perform public.set_company_plan(i.b, 'founding', now() + interval '3 months', null, 'test');
  assert public.company_effective_tier(i.b) = (select id from public.company_tiers where slug = 'founding'), 'founding';
  assert exists (select 1 from public.company_billing_audit where company_id = i.b and action = 'set_plan'), 'audited';
  begin
    perform public.set_company_plan(i.b, 'nope', null);
    raise exception 'unknown plan accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.set_company_plan(i.b, 'startup', now() - interval '1 day');
    raise exception 'past plan end accepted';
  exception when invalid_parameter_value then null;
  end;
end $$;

-- ---------------------------------------------------------------- rollover_free_periods
do $$
declare i ids; r jsonb; s public.company_subscriptions%rowtype; old_start timestamptz;
begin
  select * into i from ids;
  -- A: free period ended, a downgrade... here an upgrade scheduled to show it's applied.
  update public.company_subscriptions set
    current_period_start = now() - interval '2 months' - interval '1 day',
    current_period_end = now() - interval '1 month' - interval '1 day',
    scheduled_tier_id = i.startup
  where company_id = i.a;
  select current_period_start into old_start from public.company_subscriptions where company_id = i.a;
  -- B: a manual plan that just ended.
  update public.company_subscriptions set manual_until = now() - interval '1 minute' where company_id = i.b;
  -- An expired hold and an expired lot.
  insert into public.company_entitlement_holds (company_id, key, qty, ref_type, ref_id, expires_at)
  values (i.b, 'outreach', 1, 'test', 'old-hold', now() - interval '1 minute');

  r := public.rollover_free_periods();
  assert (r->>'rolledOver')::int >= 1 and (r->>'expiredGrants')::int >= 1
     and (r->>'expiredLots')::int >= 1 and (r->>'releasedHolds')::int >= 1, format('rollover: %s', r);

  select * into s from public.company_subscriptions where company_id = i.a;
  assert s.current_period_end > now() and s.current_period_start <= now(), format('period moved: %s', to_jsonb(s));
  assert s.tier_id = i.startup and s.scheduled_tier_id is null, 'scheduled tier applied';
  assert public.billing_allowance_used(i.a, 'screenings') = 0, 'new period starts at 0';

  assert (select tier_id from public.company_subscriptions where company_id = i.b) = i.free, 'manual plan ended';
  assert exists (select 1 from public.company_credit_ledger where company_id = i.a and reason = 'expire' and delta = -100),
    'expire row for the lapsed lot';
  assert not exists (select 1 from public.company_entitlement_holds where ref_id = 'old-hold'), 'expired hold deleted';

  -- Cancel at period end on a free-period subscription.
  update public.company_subscriptions set cancel_at_period_end = true,
    current_period_end = now() - interval '1 minute' where company_id = i.a;
  perform public.rollover_free_periods();
  assert (select tier_id from public.company_subscriptions where company_id = i.a) = i.free, 'cancelled at period end';
end $$;

-- ---------------------------------------------------------------- usage alerts (BL-REQ-022)
do $$
declare i ids; n int;
begin
  select * into i from ids;
  perform public.consume_entitlement(i.b, 'outreach', 8, 'test', 'or-1');   -- Free: 10
  select count(*) into n from public.billing_usage_alerts() where company_id = i.b and key = 'outreach' and threshold = 80;
  assert n = 1, '80% alert';
  perform public.mark_usage_notified(i.b, public.billing_period_start(i.b), 'outreach', 80);
  assert not exists (select 1 from public.billing_usage_alerts() where company_id = i.b and key = 'outreach'), 'notified once';
  perform public.consume_entitlement(i.b, 'outreach', 2, 'test', 'or-2');
  assert exists (select 1 from public.billing_usage_alerts() where company_id = i.b and key = 'outreach' and threshold = 100),
    '100% alert';
end $$;

-- ---------------------------------------------------------------- get_company_entitlements as service role
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
do $$
declare i ids; r jsonb;
begin
  select * into i from ids;
  r := public.get_company_entitlements(i.b);
  assert r->>'tier_slug' = 'free', format('tier: %s', r->>'tier_slug');
  assert (r->'entitlements'->'outreach'->>'used')::int = 10, format('outreach: %s', r->'entitlements'->'outreach');
  assert (r->>'credit_balance')::int = 100 and jsonb_array_length(r->'credit_lots') = 1, format('credits: %s', r);
end $$;

-- ---------------------------------------------------------------- as company A (BL-TEST-023)
select set_config('request.jwt.claims', '{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;

do $$
declare i ids; r jsonb; before_row record;
begin
  select * into i from ids;
  r := public.get_company_entitlements(i.a);
  assert r ? 'entitlements', 'A reads its own entitlements';

  begin
    perform public.get_company_entitlements(i.b);
    raise exception 'A read B''s entitlements';
  exception when insufficient_privilege then null;
  end;

  select tier_id, ai_credits, job_posts_created into before_row
    from public.company_info where id = i.a;
  update public.company_info set ai_credits = 99999, tier_id = i.enterprise,
         job_posts_created = 0 where id = i.a;
  assert (select (tier_id, ai_credits, job_posts_created) from public.company_info where id = i.a)
         = (before_row.tier_id, before_row.ai_credits, before_row.job_posts_created),
    'billing columns changed by the company';

  begin
    insert into public.company_credit_ledger (company_id, delta, reason, remaining) values (i.a, 1000, 'grant', 1000);
    raise exception 'A inserted into the ledger';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.company_usage (company_id, period_start, key) values (i.a, now(), 'screenings');
    raise exception 'A inserted usage';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.company_usage_events (company_id, key, qty, source, ref_type, ref_id)
    values (i.a, 'screenings', 1, 'allowance', 't', 'x');
    raise exception 'A inserted a usage event';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.company_entitlement_holds (company_id, key, qty, ref_type, ref_id) values (i.a, 'outreach', 1, 't', 'x');
    raise exception 'A inserted a hold';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.company_subscriptions (company_id, tier_id) values (i.a, i.enterprise);
    raise exception 'A inserted a subscription';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.company_subscriptions set tier_id = i.enterprise where company_id = i.a;
    raise exception 'A updated its subscription';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.company_usage where company_id = i.a;
    raise exception 'A reset its usage';
  exception when insufficient_privilege then null;
  end;

  -- BL-DEC-007: A is on Free with 2 active posts; a third can't be activated directly.
  begin
    update public.job_postings set status = 'active'
     where company_id = i.a and title = 'A3';
    raise exception 'A activated a job post over its limit';
  exception when raise_exception then
    if sqlerrm <> 'entitlement:active_job_posts' then raise; end if;
  end;
  -- Deactivating is always allowed.
  update public.job_postings set status = 'inactive' where company_id = i.a and title = 'A1';
  assert (select status from public.job_postings where company_id = i.a and title = 'A1') = 'inactive',
    'A deactivated a post';

  assert (select count(*) from public.company_subscriptions) = 1, 'A sees only its subscription';
  assert not exists (select 1 from public.company_usage where company_id = i.b), 'A sees B''s usage';
  assert not exists (select 1 from public.company_credit_ledger where company_id = i.b), 'A sees B''s ledger';
  assert not exists (select 1 from public.company_usage_events where company_id = i.b), 'A sees B''s usage events';
  assert exists (select 1 from public.company_credit_ledger where company_id = i.a), 'A sees its own ledger';

  begin
    perform public.consume_entitlement(i.a, 'screenings', 1, 't', 'x');
    raise exception 'A executed consume_entitlement';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.grant_company_credits(i.a, 1000, 'grant', null);
    raise exception 'A executed grant_company_credits';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.set_company_plan(i.a, 'enterprise', null);
    raise exception 'A executed set_company_plan';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;

-- ---------------------------------------------------------------- anon
set local role anon;
do $$
begin
  assert exists (select 1 from public.company_tiers where slug = 'startup'), 'anon sees public plans';
  assert not exists (select 1 from public.company_tiers where slug = 'founding'), 'anon sees founding';
  assert exists (select 1 from public.tier_entitlements), 'anon sees public entitlements';
end $$;
reset role;

select 'company_billing: ok' as result;

rollback;
