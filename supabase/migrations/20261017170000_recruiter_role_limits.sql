-- Recruiter roles, phase 6: per-member monthly caps (plan/recruiter-roles/feature-recruiter-roles-spec.md
-- RP-REQ-040..044, RPT-061).
--
-- A role can cap how much of an allowance key each member spends per usage
-- period. The cap is checked inside consume_entitlement / hold_entitlement, in
-- the same transaction that charges (both already lock the company's
-- subscription row, so concurrent charges are serialised per company and two
-- can't both pass the last unit). Owners and system work (no actor) are never
-- capped. Over the cap the result is { ok: false, reason: 'member_limit',
-- limit, used }, distinct from the company running out.

-- RP-REQ-043: a screening queued by a member is charged to them when the
-- worker runs (the worker passes it to consume_entitlement as the actor).
-- Screenings the system queues on apply leave it null and aren't capped.
alter table public.application_screenings
  add column if not exists requested_by uuid references auth.users(id) on delete set null;

-- The cap and the member's usage this period (events plus open holds), or
-- null when the actor isn't capped for the key.
create or replace function public.member_limit_state(p_company_id uuid, p_key text, p_actor uuid)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'limit', rl.monthly_amount,
    'used',
      coalesce((
        select sum(e.qty) from public.company_usage_events e
         where e.company_id = p_company_id and e.actor_user_id = p_actor and e.key = p_key
           and e.created_at >= public.billing_period_start(p_company_id)
      ), 0)
      + coalesce((
        select sum(h.qty) from public.company_entitlement_holds h
         where h.company_id = p_company_id and h.actor_user_id = p_actor and h.key = p_key
           and h.expires_at > now()
      ), 0)
  )
  from public.company_members m
  join public.company_role_limits rl on rl.role_id = m.role_id and rl.key = p_key
  where m.company_id = p_company_id and m.user_id = p_actor and not m.is_owner
$$;

-- For assertAllowance (a check before queueing): { allowed, limit, used }.
create or replace function public.check_member_limit(p_company_id uuid, p_key text, p_qty int, p_actor uuid)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare v_state jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' and not public.is_company_member(p_company_id) then
    raise exception 'not a member of company %', p_company_id using errcode = 'insufficient_privilege';
  end if;
  v_state := case when p_actor is null then null else public.member_limit_state(p_company_id, p_key, p_actor) end;
  if v_state is null then
    return jsonb_build_object('allowed', true, 'limit', null, 'used', null);
  end if;
  return jsonb_build_object(
    'allowed', (v_state ->> 'used')::int + coalesce(p_qty, 1) <= (v_state ->> 'limit')::int,
    'limit', (v_state ->> 'limit')::int,
    'used', (v_state ->> 'used')::int
  );
end $$;

create or replace function public.consume_entitlement(
  p_company_id uuid, p_key text, p_qty integer, p_ref_type text, p_ref_id text, p_actor uuid default null
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
  v_actor uuid;
  v_member jsonb;
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
  -- the last unit of an allowance (BL-TEST-021) or of a member cap (RP-REQ-042).
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

  -- RP-REQ-043: work that runs later is charged to whoever took the hold.
  v_actor := coalesce(p_actor, v_hold.actor_user_id);

  if v_actor is not null then
    v_member := public.member_limit_state(p_company_id, p_key, v_actor);
    if v_member is not null and (v_member ->> 'used')::int + p_qty > (v_member ->> 'limit')::int then
      if v_hold.id is not null then
        insert into public.company_entitlement_holds select v_hold.*;
      end if;
      return jsonb_build_object('ok', false, 'reason', 'member_limit', 'credits_needed', 0,
        'limit', (v_member ->> 'limit')::int, 'used', (v_member ->> 'used')::int);
    end if;
  end if;

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
    perform public.billing_spend_credits(p_company_id, v_credits, p_key, p_ref_type, p_ref_id, v_actor);
  end if;

  insert into public.company_usage_events
    (company_id, key, qty, source, credits_spent, ref_type, ref_id, actor_user_id)
  values (p_company_id, p_key, p_qty, v_source, v_credits, p_ref_type, p_ref_id, v_actor);

  return jsonb_build_object('ok', true, 'source', v_source, 'credits_spent', v_credits);
end;
$$;

-- The actor is recorded on the hold (RP-REQ-043) and capped like a consume.
drop function if exists public.hold_entitlement(uuid, text, integer, text, text, timestamptz);

create or replace function public.hold_entitlement(
  p_company_id uuid, p_key text, p_qty integer, p_ref_type text, p_ref_id text,
  p_expires_at timestamptz default null, p_actor uuid default null
)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_check jsonb;
  v_existing public.company_entitlement_holds%rowtype;
  v_member jsonb;
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

  if p_actor is not null then
    v_member := public.member_limit_state(p_company_id, p_key, p_actor);
    if v_member is not null and (v_member ->> 'used')::int + p_qty > (v_member ->> 'limit')::int then
      return jsonb_build_object('ok', false, 'reason', 'member_limit', 'credits_needed', 0,
        'limit', (v_member ->> 'limit')::int, 'used', (v_member ->> 'used')::int);
    end if;
  end if;

  v_check := public.check_entitlement(p_company_id, p_key, p_qty);
  if not (v_check->>'allowed')::boolean then
    return jsonb_build_object('ok', false, 'reason', v_check->>'reason',
      'credits_needed', (v_check->>'credits_needed')::int);
  end if;

  insert into public.company_entitlement_holds (company_id, key, qty, ref_type, ref_id, expires_at, actor_user_id)
  values (p_company_id, p_key, p_qty, p_ref_type, p_ref_id,
          coalesce(p_expires_at, now() + interval '30 days'), p_actor);

  return jsonb_build_object('ok', true);
end;
$$;

-- RP-REQ-044: usage per member this period (or the period starting at
-- p_period_start), with each member's caps, for billing.view.
create or replace function public.member_usage(p_period_start timestamptz default null)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  with c as (
    select public.my_company_id() as id,
           coalesce(p_period_start, public.billing_period_start(public.my_company_id())) as since
  )
  select case when not public.has_company_permission((select id from c), 'billing.view') then null
  else coalesce((
    select jsonb_agg(jsonb_build_object(
             'user_id', m.user_id,
             'name', public.member_display_name(m.user_id),
             'is_owner', m.is_owner,
             'role', case when r.id is null then null else jsonb_build_object('id', r.id, 'name', r.name) end,
             'usage', coalesce((
               select jsonb_object_agg(x.key, x.qty) from (
                 select e.key, sum(e.qty)::int as qty from public.company_usage_events e
                  where e.company_id = m.company_id and e.actor_user_id = m.user_id
                    and e.created_at >= (select since from c)
                    and e.created_at < (select since from c) + interval '1 month'
                  group by e.key
               ) x
             ), '{}'::jsonb),
             'limits', case when m.is_owner then '{}'::jsonb else public.role_limits_json(m.role_id) end
           ) order by m.is_owner desc, m.created_at)
      from public.company_members m
      left join public.company_roles r on r.id = m.role_id
     where m.company_id = (select id from c)
  ), '[]'::jsonb) end
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'consume_entitlement(uuid, text, integer, text, text, uuid)',
    'hold_entitlement(uuid, text, integer, text, text, timestamptz, uuid)',
    'member_limit_state(uuid, text, uuid)',
    'check_member_limit(uuid, text, integer, uuid)'
  ]
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;

  execute 'revoke all on function public.member_usage(timestamptz) from public, anon';
  execute 'grant execute on function public.member_usage(timestamptz) to authenticated, service_role';
end $$;
