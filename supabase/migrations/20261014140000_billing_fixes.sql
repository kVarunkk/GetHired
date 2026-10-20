-- Billing spec phase 1 (plan/recruiter-billing/feature-recruiter-billing-spec.md, BL-TASK-001/002):
-- the applicant payment fixes, independent of the company billing model.
--   BL-F01  price_plan.audience, so checkout can refuse company packs.
--   BL-F02  fulfil_payment: one transaction, row lock, atomic increment.
--   BL-F03  billing_webhook_events: every delivery is stored, duplicates are no-ops.
--   BL-F04  ai_credits (and payments.credit_amount) smallint -> integer.
-- Idempotent: safe to run twice.

-- ------------------------------------------------------------ BL-F04
alter table public.user_info alter column ai_credits type integer;
alter table public.company_info alter column ai_credits type integer;
alter table public.payments alter column credit_amount type integer;

-- ------------------------------------------------------------ price_plan
alter table public.price_plan
  add column if not exists audience text not null default 'applicant';

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.price_plan'::regclass and conname = 'price_plan_audience_check'
  ) then
    alter table public.price_plan
      add constraint price_plan_audience_check check (audience in ('applicant', 'company'));
  end if;
end $$;

-- RLS already allows only select; narrow the grants too (defence in depth).
revoke all on public.price_plan from anon, authenticated;
grant select on public.price_plan to anon, authenticated;

-- ------------------------------------------------------------ webhook events
create table if not exists public.billing_webhook_events (
  webhook_id text primary key,       -- Dodo 'webhook-id' header
  event_type text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error text,
  payload jsonb not null
);

alter table public.billing_webhook_events enable row level security;
-- No policies: only the service role reads or writes these.
revoke all on public.billing_webhook_events from anon, authenticated;

-- ------------------------------------------------------------ fulfil_payment
-- Fulfils one payment row exactly once. The credit amount comes from the
-- payment's price_plan row, never from the webhook payload. The row lock makes
-- concurrent deliveries of the same payment wait, then see it already done.
-- Phase 3 extends this for company credits (BLT-079).
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

  if v_payment.credits_fulfilled then
    return jsonb_build_object(
      'status', 'already_fulfilled',
      'user_id', v_payment.user_id,
      'credit_amount', v_payment.credit_amount
    );
  end if;

  select pp.credit_amount into v_credits
    from public.price_plan pp
   where pp.id = v_payment.price_plan_id
     and pp.audience = 'applicant';

  if v_credits is null or v_credits <= 0 then
    raise exception 'payment % has no applicant price plan', p_payment_row_id;
  end if;

  update public.user_info
     set ai_credits = coalesce(ai_credits, 0) + v_credits,
         updated_at = now()
   where user_id = v_payment.user_id;

  if not found then
    raise exception 'user % for payment % not found', v_payment.user_id, p_payment_row_id;
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
    'user_id', v_payment.user_id,
    'credit_amount', v_credits
  );
end;
$$;

revoke all on function public.fulfil_payment(uuid, text, text) from public, anon, authenticated;
grant execute on function public.fulfil_payment(uuid, text, text) to service_role;
