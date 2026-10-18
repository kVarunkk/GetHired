-- Recruiter outreach, part 1 (OR-TASK-001, ORT-011): outreach messages, the
-- candidate's blocks and outreach preference, and the RPCs that send, answer
-- and expire them. See plan/recruiter-outreach/feature-recruiter-outreach-spec.md and the
-- "Differences from the spec" in plan/recruiter-outreach/feature-recruiter-outreach-tasks.md.
--
-- 1. user_info.accepts_outreach
-- 2. candidate_outreach, candidate_company_blocks (+ RLS)
-- 3. company_can_view_candidate gains the block check (difference 7)
-- 4. send_candidate_outreach, respond_to_outreach, expire_outreach
-- 5. Applications from an interested outreach get source = 'outreach' (difference 8)
--
-- Monthly limits are NOT counted here: the billing ledger is the only monthly
-- counter (difference 1). helpers/outreach/send.ts holds the `outreach`
-- allowance, calls send_candidate_outreach with the outreach id as p_id, then
-- consumes or releases the hold.
-- Tests: supabase/tests/recruiter_outreach.sql, block 1.

-- ---------------------------------------------------------------------------
-- 1. Preference (OR-REQ-012)
-- ---------------------------------------------------------------------------

alter table public.user_info
  add column if not exists accepts_outreach boolean not null default true;

-- ---------------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------------

create table if not exists public.candidate_outreach (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.company_info(id) on delete cascade,
  candidate_user_id uuid not null references auth.users(id) on delete cascade,
  job_post_id uuid references public.job_postings(id) on delete set null,
  -- Nullable so a departed member's outreach survives (`on delete set null`).
  sender_user_id uuid references auth.users(id) on delete set null,
  subject text not null check (char_length(subject) between 1 and 120),
  message text not null check (char_length(message) between 1 and 2000),
  status text not null default 'sent'
    check (status in ('sent','interested','not_interested','expired','withdrawn','reported')),
  decline_reason text check (decline_reason in
    ('not_looking','role_mismatch','location','compensation','company','other')),
  candidate_note text check (char_length(candidate_note) <= 500),
  candidate_contact text check (char_length(candidate_contact) <= 120),
  source text not null default 'manual' check (source in ('manual','agent')),
  sent_at timestamptz not null default now(),
  responded_at timestamptz,
  expires_at timestamptz not null default now() + interval '30 days'
);

-- One open outreach per (company, candidate, job), "no job" counting as one job.
create unique index if not exists candidate_outreach_one_open
  on public.candidate_outreach
     (company_id, candidate_user_id, coalesce(job_post_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where status = 'sent';
create index if not exists candidate_outreach_candidate_sent_idx
  on public.candidate_outreach (candidate_user_id, sent_at desc);
create index if not exists candidate_outreach_company_sent_idx
  on public.candidate_outreach (company_id, sent_at desc, id desc);
create index if not exists candidate_outreach_company_candidate_idx
  on public.candidate_outreach (company_id, candidate_user_id, sent_at desc);
create index if not exists candidate_outreach_open_expiry_idx
  on public.candidate_outreach (expires_at) where status = 'sent';

create table if not exists public.candidate_company_blocks (
  candidate_user_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid not null references public.company_info(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (candidate_user_id, company_id)
);
create index if not exists candidate_company_blocks_company_idx
  on public.candidate_company_blocks (company_id, candidate_user_id);

alter table public.candidate_outreach enable row level security;
alter table public.candidate_company_blocks enable row level security;

-- candidate_outreach: inserts go through send_candidate_outreach and answers
-- through respond_to_outreach. The only direct write is a company withdrawing
-- its own open outreach, and the only column it may touch is status
-- (OR-SEC-003).
revoke insert, update, delete on public.candidate_outreach from anon, authenticated;
revoke select on public.candidate_outreach from anon;
grant select on public.candidate_outreach to authenticated;
grant update (status) on public.candidate_outreach to authenticated;

drop policy if exists "candidate_outreach_select_company" on public.candidate_outreach;
create policy "candidate_outreach_select_company" on public.candidate_outreach
  for select to authenticated using (public.is_company_member(company_id));

drop policy if exists "candidate_outreach_select_candidate" on public.candidate_outreach;
create policy "candidate_outreach_select_candidate" on public.candidate_outreach
  for select to authenticated using ((select auth.uid()) = candidate_user_id);

drop policy if exists "candidate_outreach_withdraw_company" on public.candidate_outreach;
create policy "candidate_outreach_withdraw_company" on public.candidate_outreach
  for update to authenticated
  using (public.is_company_member(company_id) and status = 'sent')
  with check (public.is_company_member(company_id) and status = 'withdrawn');

-- candidate_company_blocks: the candidate's own rows only. Companies get no
-- policy, so they can't tell they were blocked.
revoke all on public.candidate_company_blocks from anon;
grant select, insert, delete on public.candidate_company_blocks to authenticated;

drop policy if exists "candidate_company_blocks_own" on public.candidate_company_blocks;
create policy "candidate_company_blocks_own" on public.candidate_company_blocks
  for all to authenticated
  using ((select auth.uid()) = candidate_user_id)
  with check ((select auth.uid()) = candidate_user_id);

-- ---------------------------------------------------------------------------
-- 3. Discovery check: a block hides a talent-pool candidate (OR-SEC-004)
-- ---------------------------------------------------------------------------

-- Still "public, or applied" (RS-SEC-003). A public candidate who blocked the
-- caller's company is no longer discoverable; an applicant stays visible to
-- the company they applied to.
create or replace function public.company_can_view_candidate(p_user_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select public.my_company_id() is not null and (
    (
      exists (select 1 from public.user_info u where u.user_id = p_user_id and u.is_public)
      and not exists (
        select 1 from public.candidate_company_blocks b
        where b.candidate_user_id = p_user_id and b.company_id = public.my_company_id()
      )
    )
    or exists (
      select 1 from public.applications a
      join public.job_postings jp on jp.id = a.job_post_id
      where a.applicant_user_id = p_user_id and jp.company_id = public.my_company_id()
    )
  )
$$;

-- ---------------------------------------------------------------------------
-- 4. RPCs
-- ---------------------------------------------------------------------------

-- Errors are raised as `P0001` with the code as the message, mapped to user
-- copy by helpers/outreach/errors.ts:
--   NOT_MEMBER, INVALID_INPUT, JOB_NOT_FOUND, NOT_FOUND (also for a block, so a
--   company can't detect one), NOT_ACCEPTING, ALREADY_OPEN, CANDIDATE_LIMIT.
create or replace function public.send_candidate_outreach(
  p_id uuid,
  p_candidate uuid,
  p_job_post uuid,
  p_subject text,
  p_message text,
  p_source text default 'manual'
)
returns public.candidate_outreach
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_company uuid := public.my_company_id();
  v_accepts boolean;
  v_recent int;
  v_row public.candidate_outreach;
begin
  if v_uid is null or v_company is null then
    raise exception using errcode = 'P0001', message = 'NOT_MEMBER';
  end if;
  if p_candidate is null or p_source not in ('manual','agent')
     or char_length(coalesce(p_subject, '')) not between 1 and 120
     or char_length(coalesce(p_message, '')) not between 1 and 2000 then
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
  end if;

  if p_job_post is not null and not exists (
    select 1 from public.job_postings jp where jp.id = p_job_post and jp.company_id = v_company
  ) then
    raise exception using errcode = 'P0001', message = 'JOB_NOT_FOUND';
  end if;

  if not public.company_can_view_candidate(p_candidate)
     or exists (
       select 1 from public.candidate_company_blocks b
       where b.candidate_user_id = p_candidate and b.company_id = v_company
     ) then
    raise exception using errcode = 'P0001', message = 'NOT_FOUND';
  end if;

  select u.accepts_outreach into v_accepts from public.user_info u where u.user_id = p_candidate;
  if not coalesce(v_accepts, false) then
    raise exception using errcode = 'P0001', message = 'NOT_ACCEPTING';
  end if;

  -- Serialise sends from this company to this candidate, so two at once can't
  -- both see 2 recent rows and both insert (difference 2).
  perform pg_advisory_xact_lock(hashtextextended(v_company::text || p_candidate::text, 0));

  if exists (
    select 1 from public.candidate_outreach o
    where o.company_id = v_company and o.candidate_user_id = p_candidate and o.status = 'sent'
      and o.job_post_id is not distinct from p_job_post
  ) then
    raise exception using errcode = 'P0001', message = 'ALREADY_OPEN';
  end if;

  select count(*) into v_recent from public.candidate_outreach o
   where o.company_id = v_company and o.candidate_user_id = p_candidate
     and o.sent_at > now() - interval '90 days';
  if v_recent >= 3 then
    raise exception using errcode = 'P0001', message = 'CANDIDATE_LIMIT';
  end if;

  begin
    insert into public.candidate_outreach
      (id, company_id, candidate_user_id, job_post_id, sender_user_id, subject, message, source)
    values
      (coalesce(p_id, gen_random_uuid()), v_company, p_candidate, p_job_post, v_uid,
       p_subject, p_message, p_source)
    returning * into v_row;
  exception when unique_violation then
    raise exception using errcode = 'P0001', message = 'ALREADY_OPEN';
  end;

  -- The event never carries the message (difference 9).
  insert into public.application_events
    (company_id, application_id, candidate_user_id, actor_user_id, type, payload)
  values
    (v_company, null, p_candidate, v_uid, 'outreach_sent',
     jsonb_build_object('outreach_id', v_row.id, 'job_post_id', v_row.job_post_id));

  return v_row;
end $$;

-- The candidate's answer (OR-SEC-003). Codes: NOT_FOUND, INVALID_INPUT,
-- ALREADY_ANSWERED, EXPIRED.
create or replace function public.respond_to_outreach(
  p_id uuid,
  p_status text,
  p_reason text default null,
  p_note text default null,
  p_contact text default null,
  p_block boolean default false
)
returns public.candidate_outreach
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.candidate_outreach;
begin
  if p_status is null or p_status not in ('interested','not_interested','reported') then
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
  end if;

  select * into v_row from public.candidate_outreach o
   where o.id = p_id and o.candidate_user_id = v_uid
   for update;
  if v_uid is null or not found then
    raise exception using errcode = 'P0001', message = 'NOT_FOUND';
  end if;
  if v_row.status <> 'sent' then
    raise exception using errcode = 'P0001', message = 'ALREADY_ANSWERED';
  end if;
  if v_row.expires_at <= now() then
    raise exception using errcode = 'P0001', message = 'EXPIRED';
  end if;

  update public.candidate_outreach o
     set status = p_status,
         responded_at = now(),
         decline_reason = case when p_status = 'not_interested' then nullif(p_reason, '') end,
         candidate_note = case when p_status in ('interested','reported') then nullif(p_note, '') end,
         candidate_contact = case when p_status = 'interested' then nullif(p_contact, '') end
   where o.id = p_id
  returning * into v_row;

  insert into public.application_events
    (company_id, application_id, candidate_user_id, actor_user_id, type, payload)
  values
    (v_row.company_id, null, v_row.candidate_user_id, null, 'outreach_replied',
     jsonb_build_object('outreach_id', v_row.id, 'job_post_id', v_row.job_post_id,
                        'status', v_row.status));

  if coalesce(p_block, false) then
    insert into public.candidate_company_blocks (candidate_user_id, company_id)
    values (v_uid, v_row.company_id)
    on conflict do nothing;
  end if;

  return v_row;
end $$;

-- Daily (OR-TASK-005). Returns how many outreach expired.
create or replace function public.expire_outreach()
returns integer
language sql security definer
set search_path = ''
as $$
  with expired as (
    update public.candidate_outreach
       set status = 'expired'
     where status = 'sent' and expires_at <= now()
    returning 1
  )
  select count(*)::int from expired
$$;

revoke all on function public.send_candidate_outreach(uuid, uuid, uuid, text, text, text) from public, anon;
revoke all on function public.respond_to_outreach(uuid, text, text, text, text, boolean) from public, anon;
revoke all on function public.expire_outreach() from public, anon, authenticated;
grant execute on function public.send_candidate_outreach(uuid, uuid, uuid, text, text, text) to authenticated;
grant execute on function public.respond_to_outreach(uuid, text, text, text, text, boolean) to authenticated;
grant execute on function public.expire_outreach() to service_role;

-- ---------------------------------------------------------------------------
-- 5. source = 'outreach' (OR-REQ-004, difference 8)
-- ---------------------------------------------------------------------------

-- Same as 20261015190000_recruiter_pipeline.sql, except that an applicant's
-- insert to a company that has an `interested` outreach from them gets
-- source = 'outreach'.
create or replace function public.protect_application_pipeline_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_company uuid;
begin
  if current_role <> 'authenticated' then
    return new;
  end if;

  if new.job_post_id is null then
    if tg_op = 'UPDATE' and old.job_post_id is not null then
      raise exception 'Only the company can change this application.'
        using errcode = 'insufficient_privilege';
    end if;
    new.stage_id := null;
    return new;
  end if;

  select jp.company_id into v_company from public.job_postings jp where jp.id = new.job_post_id;
  if v_company is not null and public.is_company_member(v_company) then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- The sync trigger assigns the Applied stage.
    new.status := 'submitted';
    new.stage_id := null;
    new.stage_entered_at := now();
    -- RLS lets the applicant read their own outreach (the insert policy already
    -- requires applicant_user_id = auth.uid()).
    if v_company is not null and exists (
      select 1 from public.candidate_outreach o
      where o.company_id = v_company and o.candidate_user_id = new.applicant_user_id
        and o.status = 'interested'
    ) then
      new.source := 'outreach';
    elsif new.source not in ('applied','agent') then
      new.source := 'applied';
    end if;
    return new;
  end if;

  if new.status is distinct from old.status
     or new.stage_id is distinct from old.stage_id
     or new.stage_entered_at is distinct from old.stage_entered_at
     or new.source is distinct from old.source
     or new.job_post_id is distinct from old.job_post_id then
    raise exception 'Only the company can change this application''s status or stage.'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end $$;
