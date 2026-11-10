-- State machines (plan/state-machines/feature-state-machines-tasks.md):
-- block 1 (SMT-005) set_job_post_status, block 2 (SMT-012) worker claims,
-- block 3 (SMT-032) matching starts, block 4 (SMT-050) lifecycle checks, block 5 (SMT-054) named timestamp
-- states. Runs in a transaction that always
-- rolls back, so it's safe against the linked project once the migrations
-- are applied:
--   npx supabase db query --linked -f supabase/tests/state_machines.sql
-- Any failed check raises an exception; success prints 'state_machines: ok'.
-- Ids match supabase/tests/candidate_pool.sql where they overlap.

begin;

create function pg_temp.act(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
    case when p_user is null then '' else json_build_object('sub', p_user, 'role', 'authenticated')::text end, true)
$$;
-- Checks a { ok, reason } result: ok when p_reason is null, else that reason.
create function pg_temp.expect(p_res jsonb, p_reason text, p_label text) returns jsonb language plpgsql as $$
begin
  if p_reason is null and not coalesce((p_res ->> 'ok')::boolean, false) then
    raise exception '%: expected ok, got %', p_label, p_res;
  end if;
  if p_reason is not null and p_res ->> 'reason' is distinct from p_reason then
    raise exception '%: expected %, got %', p_label, p_reason, p_res;
  end if;
  return p_res;
end $$;
-- Both statuses of a job post, read past RLS: 'job_postings/all_jobs'.
create function pg_temp.statuses(p_post uuid) returns text language sql security definer as $$
  select jp.status::text || '/' || coalesce(aj.status::text, '-')
    from public.job_postings jp left join public.all_jobs aj on aj.id = jp.job_id
   where jp.id = p_post
$$;

grant execute on function pg_temp.act(uuid), pg_temp.expect(jsonb, text, text), pg_temp.statuses(uuid) to authenticated;

-- Seed. Company A: owner, Viewer (jobs.view only), Scoped (jobs.publish on
-- A2 only). Company B: owner.
insert into auth.users (id, email, aud, role, email_confirmed_at, raw_user_meta_data) values
  ('c1000000-0000-4000-8000-000000000001', 'hr@acme.test', 'authenticated', 'authenticated', now(), '{}'),
  ('c1000000-0000-4000-8000-000000000002', 'hr@globex.test', 'authenticated', 'authenticated', now(), '{}'),
  ('c6000000-0000-4000-8000-000000000001', 'viewer@acme.test', 'authenticated', 'authenticated', now(), '{}'),
  ('c5000000-0000-4000-8000-000000000001', 'scoped@acme.test', 'authenticated', 'authenticated', now(), '{}');

insert into public.company_info (id, user_id, name, email) values
  ('c0000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'Acme', 'hr@acme.test'),
  ('c0000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000002', 'Globex', 'hr@globex.test');

insert into public.all_jobs (id, job_name, job_url, company_name, platform, status) values
  ('d0000000-0000-4000-8000-000000000001', 'A1', 'https://acme.test/jobs/1', 'Acme', 'gethired', 'active'),
  ('d0000000-0000-4000-8000-000000000003', 'A2', 'https://acme.test/jobs/2', 'Acme', 'gethired', 'active');

insert into public.job_postings (id, company_id, title, job_id, status) values
  ('b0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'A1', 'd0000000-0000-4000-8000-000000000001', 'active'),
  ('b0000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000001', 'A2', 'd0000000-0000-4000-8000-000000000003', 'active');

do $$
declare
  a uuid := 'c0000000-0000-4000-8000-000000000001';
  v_viewer uuid;
  v_scoped uuid;
begin
  insert into public.company_roles (company_id, name) values (a, 'Viewer') returning id into v_viewer;
  insert into public.company_role_permissions (role_id, permission_key, scope) values (v_viewer, 'jobs.view', 'all');
  insert into public.company_roles (company_id, name) values (a, 'Scoped') returning id into v_scoped;
  insert into public.company_role_permissions (role_id, permission_key, scope) values
    (v_scoped, 'jobs.view', 'assigned'), (v_scoped, 'jobs.publish', 'assigned');
  insert into public.company_members (company_id, user_id, role_id, display_name) values
    (a, 'c6000000-0000-4000-8000-000000000001', v_viewer, 'Vic Viewer'),
    (a, 'c5000000-0000-4000-8000-000000000001', v_scoped, 'Sam Scoped');
  insert into public.company_job_assignments (company_id, job_post_id, user_id) values
    (a, 'b0000000-0000-4000-8000-000000000003', 'c5000000-0000-4000-8000-000000000001')
  on conflict do nothing;
end $$;

-- ================================================ block 1: set_job_post_status
-- SMT-005 (migration 20261110120000_set_job_post_status.sql), SM-TEST-007.

set local role authenticated;

-- Refusals: no jobs.publish, scoped to another job, another company.
select pg_temp.act('c6000000-0000-4000-8000-000000000001');
do $$ begin
  perform pg_temp.expect(public.set_job_post_status('b0000000-0000-4000-8000-000000000001', 'inactive'),
    'forbidden', 'a member with jobs.view only');
end $$;
select pg_temp.act('c5000000-0000-4000-8000-000000000001');
do $$ begin
  perform pg_temp.expect(public.set_job_post_status('b0000000-0000-4000-8000-000000000001', 'inactive'),
    'forbidden', 'a member scoped to A2 changes A1');
  perform pg_temp.expect(public.set_job_post_status('b0000000-0000-4000-8000-000000000003', 'inactive'),
    null, 'a member scoped to A2 changes A2');
  if pg_temp.statuses('b0000000-0000-4000-8000-000000000003') <> 'inactive/inactive' then
    raise exception 'A2 after the scoped change: %', pg_temp.statuses('b0000000-0000-4000-8000-000000000003');
  end if;
end $$;
select pg_temp.act('c1000000-0000-4000-8000-000000000002');
do $$ begin
  perform pg_temp.expect(public.set_job_post_status('b0000000-0000-4000-8000-000000000001', 'inactive'),
    'forbidden', 'another company''s owner');
  if pg_temp.statuses('b0000000-0000-4000-8000-000000000001') <> 'active/active' then
    raise exception 'a refused call changed A1: %', pg_temp.statuses('b0000000-0000-4000-8000-000000000001');
  end if;
end $$;

-- The owner: both rows move together.
select pg_temp.act('c1000000-0000-4000-8000-000000000001');
do $$ begin
  perform pg_temp.expect(public.set_job_post_status('b0000000-0000-4000-8000-000000000001', 'inactive'),
    null, 'the owner deactivates A1');
  if pg_temp.statuses('b0000000-0000-4000-8000-000000000001') <> 'inactive/inactive' then
    raise exception 'A1 after deactivating: %', pg_temp.statuses('b0000000-0000-4000-8000-000000000001');
  end if;
end $$;

-- A failure in the all_jobs write leaves both rows unchanged.
reset role;
create function pg_temp.fail_all_jobs() returns trigger language plpgsql as $$
begin raise exception 'forced all_jobs failure'; end $$;
create trigger state_machines_fail_all_jobs before update on public.all_jobs
  for each row execute function pg_temp.fail_all_jobs();
set local role authenticated;
select pg_temp.act('c1000000-0000-4000-8000-000000000001');
do $$
declare v_failed boolean := false;
begin
  begin
    perform public.set_job_post_status('b0000000-0000-4000-8000-000000000003', 'active');
  exception when others then
    v_failed := true;
  end;
  if not v_failed then raise exception 'the forced all_jobs failure didn''t raise'; end if;
  if pg_temp.statuses('b0000000-0000-4000-8000-000000000003') <> 'inactive/inactive' then
    raise exception 'a failed call changed A2: %', pg_temp.statuses('b0000000-0000-4000-8000-000000000003');
  end if;
end $$;
reset role;
drop trigger state_machines_fail_all_jobs on public.all_jobs;

-- Setting the status a post already has repairs an all_jobs row that drifted.
update public.all_jobs set status = 'active' where id = 'd0000000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.act('c1000000-0000-4000-8000-000000000001');
do $$
declare v_res jsonb;
begin
  v_res := pg_temp.expect(public.set_job_post_status('b0000000-0000-4000-8000-000000000001', 'inactive'),
    null, 'the same status again');
  if (v_res ->> 'changed')::boolean then raise exception 'a repeat reported a change: %', v_res; end if;
  if pg_temp.statuses('b0000000-0000-4000-8000-000000000001') <> 'inactive/inactive' then
    raise exception 'the drifted all_jobs row wasn''t repaired: %', pg_temp.statuses('b0000000-0000-4000-8000-000000000001');
  end if;
end $$;

reset role;

-- ================================================ block 2: worker claims
-- SMT-012 (migration 20261110130000_worker_claims.sql), SM-REQ-003.

do $$
declare v_table text;
begin
  -- The claim column exists on the three worker tables, nullable.
  foreach v_table in array array['interview_analyses', 'application_screenings', 'job_relevant_profiles'] loop
    if not exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = v_table and column_name = 'claimed_at'
         and data_type = 'timestamp with time zone' and is_nullable = 'YES'
    ) then
      raise exception '% has no nullable claimed_at timestamptz', v_table;
    end if;
  end loop;
end $$;

-- explanation_status accepts every state the writers use, processing
-- included, and still refuses an unknown one. A new row has no claim.
insert into public.job_relevant_profiles (id, job_posting_id) values
  ('e7000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001');

do $$
declare
  v_state text;
  v_refused boolean := false;
begin
  if (select claimed_at from public.job_relevant_profiles where id = 'e7000000-0000-4000-8000-000000000001') is not null then
    raise exception 'a new row has a claim';
  end if;

  foreach v_state in array array['none', 'queued', 'processing', 'completed', 'failed', 'stale', 'skipped_quota'] loop
    update public.job_relevant_profiles set explanation_status = v_state, claimed_at = now()
     where id = 'e7000000-0000-4000-8000-000000000001';
  end loop;

  begin
    update public.job_relevant_profiles set explanation_status = 'running'
     where id = 'e7000000-0000-4000-8000-000000000001';
  exception when check_violation then
    v_refused := true;
  end;
  if not v_refused then raise exception 'explanation_status accepted an unknown state'; end if;
end $$;

-- ================================================ block 3: matching starts
-- SMT-032 (migration 20261110140000_matching_started_at.sql), SM-REQ-004/005,
-- SM-TEST-005. The timeout passed in is 1200 s, as the app passes it.

insert into auth.users (id, email, aud, role, email_confirmed_at, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-0000000000c1', 'ann@applicant.test', 'authenticated', 'authenticated', now(), '{}'),
  ('a0000000-0000-4000-8000-0000000000c2', 'bob@applicant.test', 'authenticated', 'authenticated', now(), '{}');
insert into public.user_info (user_id, email, full_name, filled) values
  ('a0000000-0000-4000-8000-0000000000c1', 'ann@applicant.test', 'Ann', true),
  ('a0000000-0000-4000-8000-0000000000c2', 'bob@applicant.test', 'Bob', true);
update public.job_postings set matching_status = 'completed' where id = 'b0000000-0000-4000-8000-000000000001';
update public.user_info set relevant_jobs_update_status = 'completed'
 where user_id = 'a0000000-0000-4000-8000-0000000000c1';

-- The start time of a job's run and of an applicant's, read past RLS.
create function pg_temp.job_start(p_post uuid) returns timestamptz language sql security definer as $$
  select matching_started_at from public.job_postings where id = p_post
$$;
create function pg_temp.user_start(p_user uuid) returns timestamptz language sql security definer as $$
  select relevance_started_at from public.user_info where user_id = p_user
$$;
grant execute on function pg_temp.job_start(uuid), pg_temp.user_start(uuid) to authenticated;

-- Refusals: no matching.run, another company, another applicant.
set local role authenticated;
select pg_temp.act('c6000000-0000-4000-8000-000000000001');
do $$ begin
  perform pg_temp.expect(public.start_matching('b0000000-0000-4000-8000-000000000001', 1200),
    'forbidden', 'a member with jobs.view only');
end $$;
select pg_temp.act('c1000000-0000-4000-8000-000000000002');
do $$ begin
  perform pg_temp.expect(public.start_matching('b0000000-0000-4000-8000-000000000001', 1200),
    'forbidden', 'another company''s owner');
  if pg_temp.job_start('b0000000-0000-4000-8000-000000000001') is not null then
    raise exception 'a refused start set the start time';
  end if;
end $$;
select pg_temp.act('a0000000-0000-4000-8000-0000000000c2');
do $$ begin
  perform pg_temp.expect(public.start_relevance('a0000000-0000-4000-8000-0000000000c1', 1200),
    'forbidden', 'another applicant');
end $$;

-- Two starts in a row: the first runs, the second is refused.
select pg_temp.act('c1000000-0000-4000-8000-000000000001');
do $$ begin
  perform pg_temp.expect(public.start_matching('b0000000-0000-4000-8000-000000000001', 1200),
    null, 'the owner''s first start');
  perform pg_temp.expect(public.start_matching('b0000000-0000-4000-8000-000000000001', 1200),
    'in_progress', 'a second start while the first runs');
  if pg_temp.job_start('b0000000-0000-4000-8000-000000000001') is distinct from now() then
    raise exception 'the start time is %, not now', pg_temp.job_start('b0000000-0000-4000-8000-000000000001');
  end if;
end $$;
select pg_temp.act('a0000000-0000-4000-8000-0000000000c1');
do $$ begin
  perform pg_temp.expect(public.start_relevance('a0000000-0000-4000-8000-0000000000c1', 1200),
    null, 'the applicant''s first start');
  perform pg_temp.expect(public.start_relevance('a0000000-0000-4000-8000-0000000000c1', 1200),
    'in_progress', 'a second start while the first runs');
end $$;
reset role;

-- A run that started longer ago than the timeout is dead and can restart,
-- even when an unrelated edit just moved updated_at.
update public.job_postings
   set matching_started_at = now() - interval '2 hours', title = 'A1 (edited)', updated_at = now()
 where id = 'b0000000-0000-4000-8000-000000000001';
update public.user_info
   set relevance_started_at = now() - interval '2 hours', full_name = 'Ann B', updated_at = now()
 where user_id = 'a0000000-0000-4000-8000-0000000000c1';
do $$ begin
  if pg_temp.job_start('b0000000-0000-4000-8000-000000000001') <> now() - interval '2 hours' then
    raise exception 'an unrelated edit moved the job''s start time';
  end if;
  if pg_temp.user_start('a0000000-0000-4000-8000-0000000000c1') <> now() - interval '2 hours' then
    raise exception 'an unrelated edit moved the applicant''s start time';
  end if;
end $$;
set local role authenticated;
select pg_temp.act('c1000000-0000-4000-8000-000000000001');
do $$ begin
  perform pg_temp.expect(public.start_matching('b0000000-0000-4000-8000-000000000001', 1200),
    null, 'restarting a dead run');
  if pg_temp.job_start('b0000000-0000-4000-8000-000000000001') is distinct from now() then
    raise exception 'a restart didn''t move the start time';
  end if;
end $$;
select pg_temp.act('a0000000-0000-4000-8000-0000000000c1');
do $$ begin
  perform pg_temp.expect(public.start_relevance('a0000000-0000-4000-8000-0000000000c1', 1200),
    null, 'restarting a dead applicant run');
end $$;
reset role;

-- The service role (the weekly enqueue, the onboarding worker) starts any.
update public.job_postings set matching_status = 'failed' where id = 'b0000000-0000-4000-8000-000000000003';
set local role service_role;
select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
do $$ begin
  perform pg_temp.expect(public.start_matching('b0000000-0000-4000-8000-000000000003', 1200),
    null, 'the service role');
  perform pg_temp.expect(public.start_relevance('a0000000-0000-4000-8000-0000000000c2', 1200),
    null, 'the service role for an applicant');
end $$;
reset role;

-- Every other writer that moves a row into progress stamps the start (the
-- trigger), and a move out of it leaves the start alone.
update public.job_postings set matching_status = 'completed', matching_started_at = null
 where id = 'b0000000-0000-4000-8000-000000000003';
update public.job_postings set matching_status = 'progress' where id = 'b0000000-0000-4000-8000-000000000003';
update public.user_info set relevant_jobs_update_status = 'failed'
 where user_id = 'a0000000-0000-4000-8000-0000000000c2';
do $$ begin
  if pg_temp.job_start('b0000000-0000-4000-8000-000000000003') is distinct from now() then
    raise exception 'a direct move into progress didn''t stamp the start';
  end if;
  if pg_temp.user_start('a0000000-0000-4000-8000-0000000000c2') is null then
    raise exception 'a move out of progress cleared the start';
  end if;
end $$;

-- queue_profile_refresh reads the start time, not updated_at: a dead run with
-- a fresh updated_at is restarted, not deferred.
update public.user_info
   set relevant_jobs_update_status = 'progress', relevance_started_at = now() - interval '2 hours', updated_at = now()
 where user_id = 'a0000000-0000-4000-8000-0000000000c2';
do $$
declare v_res jsonb;
begin
  v_res := public.queue_profile_refresh('a0000000-0000-4000-8000-0000000000c2', 1200);
  if not coalesce((v_res ->> 'queued')::boolean, false) then
    raise exception 'queue_profile_refresh deferred to a dead run: %', v_res;
  end if;
  if pg_temp.user_start('a0000000-0000-4000-8000-0000000000c2') is distinct from now() then
    raise exception 'queue_profile_refresh didn''t restart the clock';
  end if;
  v_res := public.queue_profile_refresh('a0000000-0000-4000-8000-0000000000c2', 1200);
  if not coalesce((v_res ->> 'deferred')::boolean, false) then
    raise exception 'queue_profile_refresh didn''t defer to a live run: %', v_res;
  end if;
end $$;

-- ================================================ block 4: lifecycle checks
-- SMT-050 (migration 20261110160000_lifecycle_checks.sql), SM-REQ-008.
-- Each column's real check constraints are copied onto a one-column temp
-- table, so a value is tested against the live definition without seeding
-- the rows the real table's foreign keys need.

create function pg_temp.state_allowed(p_table text, p_column text, p_value text) returns boolean
language plpgsql as $$
declare
  v_def text;
  v_found boolean := false;
begin
  execute 'drop table if exists pg_temp.state_probe';
  execute format('create temp table state_probe (%I text)', p_column);
  for v_def in
    select pg_get_constraintdef(c.oid)
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.conrelid = format('public.%I', p_table)::regclass
       and c.contype = 'c' and cardinality(c.conkey) = 1 and a.attname = p_column
  loop
    v_found := true;
    execute format('alter table pg_temp.state_probe add %s', v_def);
  end loop;
  if not v_found then
    raise exception '%.% has no check constraint', p_table, p_column;
  end if;
  begin
    execute format('insert into pg_temp.state_probe values (%L)', p_value);
    return true;
  exception when check_violation then
    return false;
  end;
end $$;

-- The states each table's writers use (grep of the writers on 2026-11-10):
--   application_screenings: queue-screenings.ts, mark-stale.ts, the screening
--     worker, the insert trigger (default queued).
--   interview_analyses: the analysis worker, the insert RPCs (queued).
--   resume_reviews: improve-resume.ts (completed), and the deployed applicant
--     code's old review flow (draft, processing, failed).
do $$
declare
  v_case record;
  v_state text;
begin
  for v_case in
    select * from (values
      ('application_screenings', 'status',
        array['queued', 'processing', 'completed', 'failed', 'stale', 'skipped_quota', 'insufficient_info']),
      ('interview_analyses', 'status', array['queued', 'processing', 'completed', 'failed']),
      ('resume_reviews', 'status', array['draft', 'processing', 'completed', 'failed']),
      ('job_relevant_profiles', 'explanation_status',
        array['none', 'queued', 'processing', 'completed', 'failed', 'stale', 'skipped_quota'])
    ) as t(tbl, col, states)
  loop
    foreach v_state in array v_case.states loop
      if not pg_temp.state_allowed(v_case.tbl, v_case.col, v_state) then
        raise exception '%.% refused %, which a writer uses', v_case.tbl, v_case.col, v_state;
      end if;
    end loop;
    if pg_temp.state_allowed(v_case.tbl, v_case.col, 'running') then
      raise exception '%.% accepted an unknown state', v_case.tbl, v_case.col;
    end if;
  end loop;

  if exists (select 1 from public.resume_reviews where status is null) then
    raise exception 'resume_reviews has rows with a null status after the backfill';
  end if;
end $$;

-- ================================================ block 5: named timestamp states
-- SMT-054 (migration 20261110180000_named_timestamp_states.sql), SM-REQ-010.
-- now() is the transaction's start, so it's pinned for the whole block. Rows
-- are built with jsonb_populate_record: only the timestamps matter.

do $$
declare
  v_case record;
  v_got text;
  v_past timestamptz := now() - interval '1 hour';
  v_future timestamptz := now() + interval '1 hour';
begin
  -- company_invites: accepted_at, revoked_at, expires_at.
  for v_case in
    select * from (values
      (null::timestamptz, null::timestamptz, v_future, 'pending'),
      (null, null, now(), 'expired'),
      (null, null, v_past, 'expired'),
      (v_past, null, v_future, 'accepted'),
      (v_past, null, v_past, 'accepted'),
      (null, v_past, v_future, 'revoked'),
      (null, v_past, v_past, 'revoked'),
      (v_past, v_past, v_future, 'accepted')
    ) as t(accepted_at, revoked_at, expires_at, expected)
  loop
    v_got := public.company_invite_state(jsonb_populate_record(null::public.company_invites, jsonb_build_object(
      'accepted_at', v_case.accepted_at, 'revoked_at', v_case.revoked_at, 'expires_at', v_case.expires_at)));
    if v_got is distinct from v_case.expected then
      raise exception 'company_invite_state(%): expected %, got %', v_case, v_case.expected, v_got;
    end if;
  end loop;

  -- mcp_confirmations and company_candidate_claims: used_at, expires_at.
  for v_case in
    select * from (values
      (null::timestamptz, v_future, 'unused'),
      (null, now(), 'expired'),
      (null, v_past, 'expired'),
      (v_past, v_future, 'used'),
      (v_past, v_past, 'used')
    ) as t(used_at, expires_at, expected)
  loop
    v_got := public.mcp_confirmation_state(jsonb_populate_record(null::public.mcp_confirmations, jsonb_build_object(
      'used_at', v_case.used_at, 'expires_at', v_case.expires_at)));
    if v_got is distinct from v_case.expected then
      raise exception 'mcp_confirmation_state(%): expected %, got %', v_case, v_case.expected, v_got;
    end if;
    v_got := public.company_candidate_claim_state(jsonb_populate_record(null::public.company_candidate_claims,
      jsonb_build_object('used_at', v_case.used_at, 'expires_at', v_case.expires_at)));
    if v_got is distinct from v_case.expected then
      raise exception 'company_candidate_claim_state(%): expected %, got %', v_case, v_case.expected, v_got;
    end if;
  end loop;

  -- application_knockouts: reject_email_due_at, _sent_at, _cancelled_at.
  for v_case in
    select * from (values
      (null::timestamptz, null::timestamptz, null::timestamptz, 'none'),
      (v_future, null, null, 'scheduled'),
      (now(), null, null, 'due'),
      (v_past, null, null, 'due'),
      (v_past, v_past, null, 'sent'),
      (v_past, null, v_past, 'cancelled'),
      (v_future, null, v_past, 'cancelled'),
      (null, null, v_past, 'cancelled'),
      (v_past, v_past, v_past, 'sent')
    ) as t(due_at, sent_at, cancelled_at, expected)
  loop
    v_got := public.application_knockout_state(jsonb_populate_record(null::public.application_knockouts,
      jsonb_build_object('reject_email_due_at', v_case.due_at, 'reject_email_sent_at', v_case.sent_at,
                         'reject_email_cancelled_at', v_case.cancelled_at)));
    if v_got is distinct from v_case.expected then
      raise exception 'application_knockout_state(%): expected %, got %', v_case, v_case.expected, v_got;
    end if;
  end loop;

  -- The cancel column exists, nullable.
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'application_knockouts'
       and column_name = 'reject_email_cancelled_at' and is_nullable = 'YES'
  ) then
    raise exception 'application_knockouts has no nullable reject_email_cancelled_at';
  end if;
end $$;

-- The claim RPCs read the named state: an expired MCP confirmation is
-- refused as expired, a used one as used, and an unused one is claimed once.
insert into auth.users (id, email, aud, role, email_confirmed_at, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-0000000000d1', 'mcp@sm.test', 'authenticated', 'authenticated', now(), '{}');
insert into public.mcp_confirmations (jti, tool, code, user_id, digest, expires_at, used_at) values
  ('e9000000-0000-4000-8000-000000000001', 'save_job', 'SMCODE0001', 'a0000000-0000-4000-8000-0000000000d1', 'd', now() + interval '5 minutes', null),
  ('e9000000-0000-4000-8000-000000000002', 'save_job', 'SMCODE0002', 'a0000000-0000-4000-8000-0000000000d1', 'd', now() - interval '1 minute', null),
  ('e9000000-0000-4000-8000-000000000003', 'save_job', 'SMCODE0003', 'a0000000-0000-4000-8000-0000000000d1', 'd', now() + interval '5 minutes', now());
do $$
begin
  perform pg_temp.act('a0000000-0000-4000-8000-0000000000d1');
  if public.claim_mcp_confirmation('SMCODE0001', 'd') <> 'claimed' then raise exception 'unused confirmation not claimed'; end if;
  if public.claim_mcp_confirmation('SMCODE0001', 'd') <> 'used' then raise exception 'claimed twice'; end if;
  if public.claim_mcp_confirmation('SMCODE0002', 'd') <> 'expired' then raise exception 'expired confirmation not refused'; end if;
  if public.claim_mcp_confirmation('SMCODE0003', 'd') <> 'used' then raise exception 'used confirmation not refused'; end if;
  perform pg_temp.act(null);
end $$;

select 'state_machines: ok';

rollback;
