-- Job post lifecycle (plan/job-states/feature-job-states-tasks.md, JLT-010,
-- JLT-012, JLT-013; migration 20261124120000_job_states.sql).
--   block 1  every allowed move succeeds, every other pair is invalid_transition
--   block 2  permission per move (scoped jobs.publish, approval on and off)
--   block 3  the active-post limit on open and reopen
--   block 4  status and all_jobs.status follow state
--   block 5  direct writes refused; inserts only as drafts
--   block 6  derive_job_post_status fires before enforce_active_job_post_limit
--   block 7  one event per move, actor recorded
--   block 8  close_reason, closes_at_past, no_public_row, lifecycle timestamps
--   block 9  who can read a draft or pending job
--   block 10 set_job_post_status as a wrapper
--   block 11 close_due_job_posts across time zones (JLT-041)
--   block 12 claim_closing_soon_job_posts and the reminder reset (JLT-045)
--   block 13 approval: scoped jobs.approve, the limit on approve, approval off (JLT-051)
--   block 14 link-only: all_jobs.listed follows visibility, careers list and filter lists (JLT-060)
-- Runs in a transaction that always rolls back, so it's safe against the
-- linked project once the migration is applied:
--   npx supabase db query --linked -f supabase/tests/job_states.sql
-- Any failed check raises an exception; success prints 'job_states: ok'.

begin;

create function pg_temp.act(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
    case when p_user is null then '' else json_build_object('sub', p_user, 'role', 'authenticated')::text end, true)
$$;
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
-- 'state/status/all_jobs status' of a job post, read past RLS.
create function pg_temp.st(p_post uuid) returns text language sql security definer as $$
  select jp.state::text || '/' || jp.status::text || '/' || coalesce(aj.status::text, '-')
    from public.job_postings jp left join public.all_jobs aj on aj.id = jp.job_id
   where jp.id = p_post
$$;
-- Puts a job post in a state past every check (as the table owner).
create function pg_temp.force(p_post uuid, p_state public.job_post_state) returns void
language sql security definer as $$
  update public.job_postings
     set state = p_state, close_reason = case when p_state = 'closed' then 'other'::public.job_close_reason end,
         closes_at = null
   where id = p_post;
  update public.all_jobs aj set status = jp.status
    from public.job_postings jp where jp.id = p_post and aj.id = jp.job_id;
$$;
create function pg_temp.events(p_post uuid) returns bigint language sql security definer as $$
  select count(*) from public.job_post_state_events where job_post_id = p_post
$$;
-- Whether `sql` raises, as the current role.
create function pg_temp.raises(p_sql text) returns boolean language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when others then
  return true;
end $$;

grant execute on function pg_temp.act(uuid), pg_temp.expect(jsonb, text, text), pg_temp.st(uuid),
  pg_temp.force(uuid, public.job_post_state), pg_temp.events(uuid), pg_temp.raises(text) to authenticated, anon;

-- Seed. Company A (Enterprise, no limit): owner, Viewer (jobs.view), Publisher
-- (view + publish), Publisher 2, Approver (view + publish + approve), Scoped
-- (view + publish on A2 only). Company B (Free, 2 active posts): owner.
insert into auth.users (id, email, aud, role, email_confirmed_at, raw_user_meta_data) values
  ('c1000000-0000-4000-8000-000000000001', 'hr@acme.test', 'authenticated', 'authenticated', now(), '{}'),
  ('c1000000-0000-4000-8000-000000000002', 'hr@globex.test', 'authenticated', 'authenticated', now(), '{}'),
  ('c6000000-0000-4000-8000-000000000001', 'viewer@acme.test', 'authenticated', 'authenticated', now(), '{}'),
  ('c7000000-0000-4000-8000-000000000001', 'publisher@acme.test', 'authenticated', 'authenticated', now(), '{}'),
  ('c7000000-0000-4000-8000-000000000002', 'publisher2@acme.test', 'authenticated', 'authenticated', now(), '{}'),
  ('c8000000-0000-4000-8000-000000000001', 'approver@acme.test', 'authenticated', 'authenticated', now(), '{}'),
  ('c5000000-0000-4000-8000-000000000001', 'scoped@acme.test', 'authenticated', 'authenticated', now(), '{}'),
  ('c9000000-0000-4000-8000-000000000001', 'seeker@example.test', 'authenticated', 'authenticated', now(), '{}');

insert into public.company_info (id, user_id, name, email) values
  ('c0000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'Acme', 'hr@acme.test'),
  ('c0000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000002', 'Globex', 'hr@globex.test');

update public.company_subscriptions set tier_id = (select id from public.company_tiers where slug = 'enterprise')
 where company_id = 'c0000000-0000-4000-8000-000000000001';

insert into public.all_jobs (id, job_name, job_url, company_name, platform, status) values
  ('d0000000-0000-4000-8000-000000000001', 'A1', 'https://acme.test/jobs/1', 'Acme', 'gethired', 'inactive'),
  ('d0000000-0000-4000-8000-000000000002', 'A2', 'https://acme.test/jobs/2', 'Acme', 'gethired', 'inactive'),
  ('d0000000-0000-4000-8000-000000000011', 'B1', 'https://globex.test/jobs/1', 'Globex', 'gethired', 'active'),
  ('d0000000-0000-4000-8000-000000000012', 'B2', 'https://globex.test/jobs/2', 'Globex', 'gethired', 'active'),
  ('d0000000-0000-4000-8000-000000000013', 'B3', 'https://globex.test/jobs/3', 'Globex', 'gethired', 'inactive'),
  ('d0000000-0000-4000-8000-000000000014', 'B4', 'https://globex.test/jobs/4', 'Globex', 'gethired', 'inactive');

-- A1, A2 drafts with a public row; A3 a draft without one; B1, B2 open
-- (inserted the legacy way, as active); B3 paused; B4 a draft.
insert into public.job_postings (id, company_id, title, job_id, state) values
  ('b0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'A1', 'd0000000-0000-4000-8000-000000000001', 'draft'),
  ('b0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001', 'A2', 'd0000000-0000-4000-8000-000000000002', 'draft'),
  ('b0000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000001', 'A3', null, 'draft');
insert into public.job_postings (id, company_id, title, job_id, status) values
  ('b0000000-0000-4000-8000-000000000011', 'c0000000-0000-4000-8000-000000000002', 'B1', 'd0000000-0000-4000-8000-000000000011', 'active'),
  ('b0000000-0000-4000-8000-000000000012', 'c0000000-0000-4000-8000-000000000002', 'B2', 'd0000000-0000-4000-8000-000000000012', 'active');
insert into public.job_postings (id, company_id, title, job_id, state) values
  ('b0000000-0000-4000-8000-000000000013', 'c0000000-0000-4000-8000-000000000002', 'B3', 'd0000000-0000-4000-8000-000000000013', 'paused'),
  ('b0000000-0000-4000-8000-000000000014', 'c0000000-0000-4000-8000-000000000002', 'B4', 'd0000000-0000-4000-8000-000000000014', 'draft');

do $$
declare
  a uuid := 'c0000000-0000-4000-8000-000000000001';
  v_viewer uuid; v_publisher uuid; v_approver uuid; v_scoped uuid;
begin
  insert into public.company_roles (company_id, name) values (a, 'Viewer') returning id into v_viewer;
  insert into public.company_role_permissions (role_id, permission_key, scope) values (v_viewer, 'jobs.view', 'all');
  insert into public.company_roles (company_id, name) values (a, 'Publisher') returning id into v_publisher;
  insert into public.company_role_permissions (role_id, permission_key, scope) values
    (v_publisher, 'jobs.view', 'all'), (v_publisher, 'jobs.publish', 'all');
  insert into public.company_roles (company_id, name) values (a, 'Approver') returning id into v_approver;
  insert into public.company_role_permissions (role_id, permission_key, scope) values
    (v_approver, 'jobs.view', 'all'), (v_approver, 'jobs.publish', 'all'), (v_approver, 'jobs.approve', 'all');
  insert into public.company_roles (company_id, name) values (a, 'Scoped') returning id into v_scoped;
  insert into public.company_role_permissions (role_id, permission_key, scope) values
    (v_scoped, 'jobs.view', 'assigned'), (v_scoped, 'jobs.publish', 'assigned');
  insert into public.company_members (company_id, user_id, role_id, display_name) values
    (a, 'c6000000-0000-4000-8000-000000000001', v_viewer, 'Vic Viewer'),
    (a, 'c7000000-0000-4000-8000-000000000001', v_publisher, 'Pat Publisher'),
    (a, 'c7000000-0000-4000-8000-000000000002', v_publisher, 'Pam Publisher'),
    (a, 'c8000000-0000-4000-8000-000000000001', v_approver, 'Ada Approver'),
    (a, 'c5000000-0000-4000-8000-000000000001', v_scoped, 'Sam Scoped');
  insert into public.company_job_assignments (company_id, job_post_id, user_id) values
    (a, 'b0000000-0000-4000-8000-000000000002', 'c5000000-0000-4000-8000-000000000001')
  on conflict do nothing;
end $$;

-- The legacy insert opened B1 and B2; the backfill-style seed paused B3.
do $$ begin
  assert pg_temp.st('b0000000-0000-4000-8000-000000000011') = 'open/active/active', 'B1 seed: ' || pg_temp.st('b0000000-0000-4000-8000-000000000011');
  assert pg_temp.st('b0000000-0000-4000-8000-000000000013') = 'paused/inactive/inactive', 'B3 seed';
  assert pg_temp.st('b0000000-0000-4000-8000-000000000001') = 'draft/inactive/inactive', 'A1 seed';
end $$;

-- ====================================================== block 1: the move table
-- With approval on, the owner (every permission) may make every allowed move,
-- so a refusal is only ever invalid_transition.

update public.company_info set job_approval_required = true where id = 'c0000000-0000-4000-8000-000000000001';

create temp table allowed_moves (from_state text, to_state text) on commit drop;
insert into allowed_moves values
  ('draft', 'open'), ('draft', 'pending_approval'),
  ('pending_approval', 'open'), ('pending_approval', 'draft'),
  ('open', 'paused'), ('open', 'closed'), ('paused', 'closed'),
  ('open', 'filled'), ('paused', 'filled'),
  ('paused', 'open'), ('closed', 'open'), ('filled', 'open'),
  ('closed', 'filled'), ('filled', 'closed');
grant select on allowed_moves to authenticated;

-- The migration's table is the same as this one (the Vitest fixture is
-- checked against the migration text in helpers/jobs/job-states.test.ts).
do $$
declare f public.job_post_state; t public.job_post_state;
begin
  foreach f in array enum_range(null::public.job_post_state) loop
    foreach t in array enum_range(null::public.job_post_state) loop
      if public.job_post_move_allowed(f, t) is distinct from
         exists (select 1 from allowed_moves m where m.from_state = f::text and m.to_state = t::text) then
        raise exception 'job_post_move_allowed(%, %) disagrees with the table', f, t;
      end if;
    end loop;
  end loop;
end $$;

set local role authenticated;
select pg_temp.act('c1000000-0000-4000-8000-000000000001');
do $$
declare
  f public.job_post_state; t public.job_post_state; v_res jsonb; v_allowed boolean;
  j uuid := 'b0000000-0000-4000-8000-000000000001';
begin
  foreach f in array enum_range(null::public.job_post_state) loop
    foreach t in array enum_range(null::public.job_post_state) loop
      continue when f = t;
      perform pg_temp.force(j, f);
      v_allowed := exists (select 1 from allowed_moves m where m.from_state = f::text and m.to_state = t::text);
      v_res := public.set_job_post_state(j, t,
        case when t = 'closed' then 'cancelled'::public.job_close_reason end, 'a note');
      if v_allowed then
        perform pg_temp.expect(v_res, null, format('%s → %s', f, t));
        if pg_temp.st(j) not like t::text || '/%' then
          raise exception '% → %: the job is %', f, t, pg_temp.st(j);
        end if;
      else
        perform pg_temp.expect(v_res, 'invalid_transition', format('%s → %s', f, t));
        if pg_temp.st(j) not like f::text || '/%' then
          raise exception '% → % refused but the job is %', f, t, pg_temp.st(j);
        end if;
      end if;
    end loop;
  end loop;
end $$;
reset role;

-- ====================================================== block 2: permissions

-- Approval off: a publisher opens a draft; submitting needs approval on.
update public.company_info set job_approval_required = false where id = 'c0000000-0000-4000-8000-000000000001';
select pg_temp.force('b0000000-0000-4000-8000-000000000001', 'draft');
select pg_temp.force('b0000000-0000-4000-8000-000000000002', 'draft');
set local role authenticated;

select pg_temp.act('c6000000-0000-4000-8000-000000000001');
do $$ begin
  perform pg_temp.expect(public.set_job_post_state('b0000000-0000-4000-8000-000000000001', 'open'),
    'forbidden', 'a member with jobs.view only');
end $$;
select pg_temp.act('c1000000-0000-4000-8000-000000000002');
do $$ begin
  perform pg_temp.expect(public.set_job_post_state('b0000000-0000-4000-8000-000000000001', 'open'),
    'not_found', 'another company''s owner');
end $$;
select pg_temp.act('c9000000-0000-4000-8000-000000000001');
do $$ begin
  perform pg_temp.expect(public.set_job_post_state('b0000000-0000-4000-8000-000000000001', 'open'),
    'not_found', 'a job seeker');
end $$;
select pg_temp.act('c5000000-0000-4000-8000-000000000001');
do $$ begin
  perform pg_temp.expect(public.set_job_post_state('b0000000-0000-4000-8000-000000000001', 'open'),
    'not_found', 'a member scoped to A2 opens A1');
  perform pg_temp.expect(public.set_job_post_state('b0000000-0000-4000-8000-000000000002', 'open'),
    null, 'a member scoped to A2 opens A2');
  perform pg_temp.expect(public.set_job_post_state('b0000000-0000-4000-8000-000000000002', 'paused'),
    null, 'a member scoped to A2 pauses A2');
end $$;
select pg_temp.act('c7000000-0000-4000-8000-000000000001');
do $$ begin
  perform pg_temp.expect(public.set_job_post_state('b0000000-0000-4000-8000-000000000001', 'pending_approval'),
    'invalid_transition', 'submit with approval off');
  perform pg_temp.expect(public.set_job_post_state('b0000000-0000-4000-8000-000000000001', 'open'),
    null, 'a publisher opens a draft with approval off');
end $$;
reset role;

-- Approval on: a publisher without jobs.approve submits instead.
update public.company_info set job_approval_required = true where id = 'c0000000-0000-4000-8000-000000000001';
select pg_temp.force('b0000000-0000-4000-8000-000000000001', 'draft');
set local role authenticated;
select pg_temp.act('c7000000-0000-4000-8000-000000000001');
do $$ begin
  perform pg_temp.expect(public.set_job_post_state('b0000000-0000-4000-8000-000000000001', 'open'),
    'approval_required', 'a publisher opens a draft with approval on');
  perform pg_temp.expect(public.set_job_post_state('b0000000-0000-4000-8000-000000000001', 'pending_approval'),
    null, 'a publisher submits');
  perform pg_temp.expect(public.set_job_post_state('b0000000-0000-4000-8000-000000000001', 'open'),
    'forbidden', 'the submitter approves their own job');
end $$;
-- Someone else without jobs.approve can't send it back.
select pg_temp.act('c7000000-0000-4000-8000-000000000002');
do $$ begin
  perform pg_temp.expect(public.set_job_post_state('b0000000-0000-4000-8000-000000000001', 'draft', null, 'no'),
    'forbidden', 'another publisher withdraws');
end $$;
-- The submitter withdraws, with no note.
select pg_temp.act('c7000000-0000-4000-8000-000000000001');
do $$ begin
  perform pg_temp.expect(public.set_job_post_state('b0000000-0000-4000-8000-000000000001', 'draft'),
    null, 'the submitter withdraws');
  perform pg_temp.expect(public.set_job_post_state('b0000000-0000-4000-8000-000000000001', 'pending_approval'),
    null, 'the publisher submits again');
end $$;
-- The approver sends it back only with a note, then approves.
select pg_temp.act('c8000000-0000-4000-8000-000000000001');
do $$ begin
  perform pg_temp.expect(public.set_job_post_state('b0000000-0000-4000-8000-000000000001', 'draft'),
    'note_required', 'request changes with no note');
  perform pg_temp.expect(public.set_job_post_state('b0000000-0000-4000-8000-000000000001', 'draft', null, 'Fix the salary'),
    null, 'request changes');
end $$;
select pg_temp.act('c7000000-0000-4000-8000-000000000001');
select pg_temp.expect(public.set_job_post_state('b0000000-0000-4000-8000-000000000001', 'pending_approval'), null, 'resubmit');
select pg_temp.act('c8000000-0000-4000-8000-000000000001');
do $$ begin
  perform pg_temp.expect(public.set_job_post_state('b0000000-0000-4000-8000-000000000001', 'open'),
    null, 'the approver approves');
  -- Reopening never needs approval again (D6).
  perform pg_temp.expect(public.set_job_post_state('b0000000-0000-4000-8000-000000000001', 'paused'), null, 'pause');
end $$;
select pg_temp.act('c7000000-0000-4000-8000-000000000001');
do $$ begin
  perform pg_temp.expect(public.set_job_post_state('b0000000-0000-4000-8000-000000000001', 'open'),
    null, 'a publisher reopens with approval on');
end $$;
-- An approver opens a draft directly.
reset role;
select pg_temp.force('b0000000-0000-4000-8000-000000000002', 'draft');
set local role authenticated;
select pg_temp.act('c8000000-0000-4000-8000-000000000001');
select pg_temp.expect(public.set_job_post_state('b0000000-0000-4000-8000-000000000002', 'open'), null, 'an approver publishes');
reset role;
update public.company_info set job_approval_required = false where id = 'c0000000-0000-4000-8000-000000000001';

-- ====================================================== block 3: the limit
-- Globex is on Free (2 active posts) with B1 and B2 open.

set local role authenticated;
select pg_temp.act('c1000000-0000-4000-8000-000000000002');
do $$ begin
  perform pg_temp.expect(public.set_job_post_state('b0000000-0000-4000-8000-000000000014', 'open'),
    'active_job_posts', 'publish over the limit');
  perform pg_temp.expect(public.set_job_post_state('b0000000-0000-4000-8000-000000000013', 'open'),
    'active_job_posts', 'reopen over the limit');
  assert pg_temp.st('b0000000-0000-4000-8000-000000000013') = 'paused/inactive/inactive', 'a refused reopen moved B3';
  perform pg_temp.expect(public.set_job_post_state('b0000000-0000-4000-8000-000000000011', 'paused'),
    null, 'pausing is always allowed');
  perform pg_temp.expect(public.set_job_post_state('b0000000-0000-4000-8000-000000000013', 'open'),
    null, 'reopen with a free slot');
end $$;
reset role;

-- ====================================================== block 4: status follows state

set local role authenticated;
select pg_temp.act('c1000000-0000-4000-8000-000000000002');
do $$
declare j uuid := 'b0000000-0000-4000-8000-000000000013';
begin
  assert pg_temp.st(j) = 'open/active/active', 'open: ' || pg_temp.st(j);
  perform pg_temp.expect(public.set_job_post_state(j, 'paused'), null, 'pause B3');
  assert pg_temp.st(j) = 'paused/inactive/inactive', 'paused: ' || pg_temp.st(j);
  perform pg_temp.expect(public.set_job_post_state(j, 'closed', 'cancelled'), null, 'close B3');
  assert pg_temp.st(j) = 'closed/inactive/inactive', 'closed: ' || pg_temp.st(j);
  perform pg_temp.expect(public.set_job_post_state(j, 'filled'), null, 'closed → filled');
  assert pg_temp.st(j) = 'filled/inactive/inactive', 'filled: ' || pg_temp.st(j);
  perform pg_temp.expect(public.set_job_post_state(j, 'open'), null, 'reopen B3');
  assert pg_temp.st(j) = 'open/active/active', 'reopened: ' || pg_temp.st(j);
end $$;

-- The same state again re-syncs a drifted public row and reports no change.
reset role;
update public.all_jobs set status = 'inactive' where id = 'd0000000-0000-4000-8000-000000000013';
set local role authenticated;
select pg_temp.act('c1000000-0000-4000-8000-000000000002');
do $$
declare v_res jsonb;
begin
  v_res := pg_temp.expect(public.set_job_post_state('b0000000-0000-4000-8000-000000000013', 'open'), null, 'open again');
  assert not (v_res ->> 'changed')::boolean, 'a repeat reported a change';
  assert pg_temp.st('b0000000-0000-4000-8000-000000000013') = 'open/active/active', 'the drifted row wasn''t repaired';
end $$;
reset role;

-- ====================================================== block 5: direct writes

set local role authenticated;
select pg_temp.act('c1000000-0000-4000-8000-000000000001');
do $$
declare j text := 'b0000000-0000-4000-8000-000000000002';
begin
  assert pg_temp.raises(format('update public.job_postings set state = %L where id = %L', 'paused', j)),
    'the owner wrote state directly';
  assert pg_temp.raises(format('update public.job_postings set status = %L where id = %L', 'inactive', j)),
    'the owner wrote status directly';
  assert pg_temp.raises(format('update public.job_postings set first_opened_at = now() - interval ''1 day'' where id = %L', j)),
    'the owner wrote first_opened_at directly';
  assert pg_temp.raises(format('update public.job_postings set closed_at = now() where id = %L', j)),
    'the owner wrote closed_at directly';
  assert pg_temp.raises(format('update public.job_postings set state_changed_at = now() - interval ''1 day'' where id = %L', j)),
    'the owner wrote state_changed_at directly';
  assert pg_temp.raises(format(
    'insert into public.job_postings (company_id, title, state) values (%L, %L, %L)',
    'c0000000-0000-4000-8000-000000000001', 'Open on insert', 'open')), 'the owner inserted an open job';
  -- An ordinary edit still works.
  update public.job_postings set title = 'A2 edited' where id = j::uuid;
  assert (select title from public.job_postings where id = j::uuid) = 'A2 edited', 'an edit failed';
  -- A draft insert is allowed, and a status sent with it is ignored.
  insert into public.job_postings (id, company_id, title, status)
  values ('b0000000-0000-4000-8000-000000000009', 'c0000000-0000-4000-8000-000000000001', 'New draft', 'active');
  assert pg_temp.st('b0000000-0000-4000-8000-000000000009') = 'draft/inactive/-',
    'a new job isn''t a draft: ' || pg_temp.st('b0000000-0000-4000-8000-000000000009');
end $$;
reset role;

-- ====================================================== block 6: trigger order
-- Over the limit, a state-only write is refused by the limit (its status was
-- derived first), not let through because `status` wasn't in the statement.

set local role authenticated;
select pg_temp.act('c1000000-0000-4000-8000-000000000002');
do $$
declare v_err text;
begin
  begin
    update public.job_postings set state = 'open' where id = 'b0000000-0000-4000-8000-000000000014';
    raise exception 'a state-only open went through';
  exception when raise_exception then
    get stacked diagnostics v_err = message_text;
    if v_err <> 'entitlement:active_job_posts' then raise; end if;
  end;
end $$;
reset role;
do $$ begin
  assert (select tgname from pg_trigger where tgrelid = 'public.job_postings'::regclass and not tgisinternal
           and tgname in ('derive_job_post_status', 'enforce_active_job_post_limit') order by tgname limit 1)
    = 'derive_job_post_status', 'derive_job_post_status doesn''t sort first';
end $$;

-- ====================================================== block 7: events

set local role authenticated;
select pg_temp.act('c1000000-0000-4000-8000-000000000002');
do $$
declare
  j uuid := 'b0000000-0000-4000-8000-000000000012';
  n bigint := pg_temp.events('b0000000-0000-4000-8000-000000000012');
begin
  perform pg_temp.expect(public.set_job_post_state(j, 'paused', null, 'Budget review'), null, 'pause B2');
  perform pg_temp.expect(public.set_job_post_state(j, 'closed', 'on_hold_indefinitely'), null, 'close B2');
  perform pg_temp.expect(public.set_job_post_state(j, 'closed', 'other'), null, 'close B2 again');
  assert pg_temp.events(j) = n + 2, 'expected two new events, got ' || (pg_temp.events(j) - n);
  -- Members read the events; the newest is the close, with its reason and actor.
  assert (select to_state::text || '/' || reason::text || '/' || actor_user_id::text
            from public.job_post_state_events where job_post_id = j order by created_at desc, id limit 1)
    = 'closed/on_hold_indefinitely/c1000000-0000-4000-8000-000000000002', 'the close event';
  assert exists (select 1 from public.job_post_state_events where job_post_id = j and note = 'Budget review'),
    'the note wasn''t kept';
  assert pg_temp.raises(format(
    'insert into public.job_post_state_events (job_post_id, company_id, to_state) values (%L, %L, %L)',
    j, 'c0000000-0000-4000-8000-000000000002', 'open')), 'a member wrote an event';
end $$;
-- Another company can't read them.
select pg_temp.act('c1000000-0000-4000-8000-000000000001');
do $$ begin
  assert not exists (select 1 from public.job_post_state_events where job_post_id = 'b0000000-0000-4000-8000-000000000012'),
    'Acme read Globex''s events';
end $$;
reset role;
do $$ begin
  assert exists (select 1 from public.company_audit_log
                  where company_id = 'c0000000-0000-4000-8000-000000000002' and action = 'job.state_changed'
                    and target_id = 'b0000000-0000-4000-8000-000000000012'), 'no audit entry';
end $$;

-- ====================================================== block 8: reasons, dates, timestamps

set local role authenticated;
select pg_temp.act('c1000000-0000-4000-8000-000000000001');
do $$
declare
  j uuid := 'b0000000-0000-4000-8000-000000000002';
  v_first timestamptz;
begin
  assert pg_temp.st(j) like 'open/%', 'A2 should be open: ' || pg_temp.st(j);
  select first_opened_at into v_first from public.job_postings where id = j;
  assert v_first is not null, 'first_opened_at is unset';

  perform pg_temp.expect(public.set_job_post_state(j, 'closed'), 'reason_required', 'close with no reason');
  perform pg_temp.expect(public.set_job_post_state(j, 'closed', 'cancelled'), null, 'close A2');
  assert (select close_reason = 'cancelled' and closed_at is not null from public.job_postings where id = j),
    'close_reason or closed_at unset';
  perform pg_temp.expect(public.set_job_post_state(j, 'filled'), null, 'closed → filled');
  assert (select close_reason is null and closed_at is not null from public.job_postings where id = j),
    'filled keeps a close reason or lost closed_at';

  -- A closing date in the past blocks reopening until it moves.
  update public.job_postings set closes_at = current_date - 2 where id = j;
  perform pg_temp.expect(public.set_job_post_state(j, 'open'), 'closes_at_past', 'reopen past the closing date');
  update public.job_postings set closes_at = null where id = j;
  perform pg_temp.expect(public.set_job_post_state(j, 'open'), null, 'reopen after clearing the date');
  assert (select closed_at is null and close_reason is null and first_opened_at = v_first
            from public.job_postings where id = j), 'reopening didn''t clear closed_at or moved first_opened_at';

  -- A draft with no public row can't open.
  perform pg_temp.expect(public.set_job_post_state('b0000000-0000-4000-8000-000000000003', 'open'),
    'no_public_row', 'open a draft without an all_jobs row');
  perform pg_temp.expect(public.set_job_post_state(j, 'paused', null, repeat('x', 501)),
    'note_too_long', 'a note over 500 characters');
end $$;
reset role;

-- ====================================================== block 9: who reads drafts (JLT-012)

update public.company_info set job_approval_required = true where id = 'c0000000-0000-4000-8000-000000000001';
select pg_temp.force('b0000000-0000-4000-8000-000000000001', 'pending_approval');
-- A3 is a draft, A1 pending, A2 open.

set local role anon;
select pg_temp.act(null);
do $$ begin
  assert not exists (select 1 from public.job_postings where id in
    ('b0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000003')), 'anon read a draft or pending job';
  assert exists (select 1 from public.job_postings where id = 'b0000000-0000-4000-8000-000000000002'),
    'anon can''t read a paused job';
end $$;
reset role;

set local role authenticated;
select pg_temp.act('c9000000-0000-4000-8000-000000000001');
do $$ begin
  assert not exists (select 1 from public.job_postings where id in
    ('b0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000003')), 'a job seeker read a draft or pending job';
end $$;
select pg_temp.act('c1000000-0000-4000-8000-000000000002');
do $$ begin
  assert not exists (select 1 from public.job_postings where id = 'b0000000-0000-4000-8000-000000000003'),
    'another company read a draft';
end $$;
select pg_temp.act('c6000000-0000-4000-8000-000000000001');
do $$ begin
  assert (select count(*) from public.job_postings where id in
    ('b0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000003')) = 2,
    'a member with jobs.view can''t read the drafts';
end $$;
reset role;
update public.company_info set job_approval_required = false where id = 'c0000000-0000-4000-8000-000000000001';

-- ====================================================== block 10: the wrapper (JLT-013)

select pg_temp.force('b0000000-0000-4000-8000-000000000002', 'open');
select pg_temp.force('b0000000-0000-4000-8000-000000000001', 'draft');
set local role authenticated;
select pg_temp.act('c1000000-0000-4000-8000-000000000001');
do $$
declare v_res jsonb;
begin
  perform pg_temp.expect(public.set_job_post_status('b0000000-0000-4000-8000-000000000002', 'inactive'), null, 'inactive on open');
  assert pg_temp.st('b0000000-0000-4000-8000-000000000002') = 'paused/inactive/inactive', 'wrapper pause';
  perform pg_temp.expect(public.set_job_post_status('b0000000-0000-4000-8000-000000000002', 'active'), null, 'active on paused');
  assert pg_temp.st('b0000000-0000-4000-8000-000000000002') = 'open/active/active', 'wrapper reopen';
  v_res := pg_temp.expect(public.set_job_post_status('b0000000-0000-4000-8000-000000000001', 'inactive'), null, 'inactive on draft');
  assert not (v_res ->> 'changed')::boolean, 'inactive on a draft changed it';
  assert pg_temp.st('b0000000-0000-4000-8000-000000000001') = 'draft/inactive/inactive', 'wrapper left the draft alone';
  perform pg_temp.expect(public.set_job_post_status('b0000000-0000-4000-8000-000000000001', 'active'), null, 'active on draft');
  assert pg_temp.st('b0000000-0000-4000-8000-000000000001') = 'open/active/active', 'wrapper publish';
  perform pg_temp.expect(public.set_job_post_status('b0000000-0000-4000-8000-0000000000ff', 'active'), 'not_found', 'no such job');
end $$;
select pg_temp.act('c1000000-0000-4000-8000-000000000002');
select pg_temp.expect(public.set_job_post_status('b0000000-0000-4000-8000-000000000001', 'inactive'),
  'forbidden', 'another company''s owner through the wrapper');
reset role;

-- ====================================================== block 11: auto-close (JLT-041)
-- Each job gets a company of its own, so each can have its own time zone.
-- 'today' is read from company_today, so the checks hold at any hour.

insert into auth.users (id, email, aud, role, email_confirmed_at, raw_user_meta_data) values
  ('c1000000-0000-4000-8000-000000000021', 'hr@west.test', 'authenticated', 'authenticated', now(), '{}'),
  ('c1000000-0000-4000-8000-000000000022', 'hr@east.test', 'authenticated', 'authenticated', now(), '{}'),
  ('c1000000-0000-4000-8000-000000000023', 'hr@india.test', 'authenticated', 'authenticated', now(), '{}');
insert into public.company_info (id, user_id, name, email, time_zone) values
  ('c0000000-0000-4000-8000-000000000021', 'c1000000-0000-4000-8000-000000000021', 'West', 'hr@west.test', 'America/Los_Angeles'),
  ('c0000000-0000-4000-8000-000000000022', 'c1000000-0000-4000-8000-000000000022', 'East', 'hr@east.test', 'Pacific/Tongatapu'),
  ('c0000000-0000-4000-8000-000000000023', 'c1000000-0000-4000-8000-000000000023', 'India', 'hr@india.test', 'Asia/Kolkata');
insert into public.all_jobs (id, job_name, job_url, company_name, platform, status) values
  ('d0000000-0000-4000-8000-000000000021', 'W1', 'https://acme.test/jobs/21', 'West', 'gethired', 'active'),
  ('d0000000-0000-4000-8000-000000000022', 'E1', 'https://acme.test/jobs/22', 'East', 'gethired', 'inactive'),
  ('d0000000-0000-4000-8000-000000000023', 'I1', 'https://acme.test/jobs/23', 'India', 'gethired', 'active'),
  ('d0000000-0000-4000-8000-000000000024', 'I2', 'https://acme.test/jobs/24', 'India', 'gethired', 'inactive'),
  ('d0000000-0000-4000-8000-000000000025', 'I3', 'https://acme.test/jobs/25', 'India', 'gethired', 'active');
-- W1 open, due yesterday (West); E1 paused, due yesterday (East); I1 open,
-- due today (India, stays open); I2 filled, past (skipped); I3 open, no date.
insert into public.job_postings (id, company_id, title, job_id, status) values
  ('b0000000-0000-4000-8000-000000000021', 'c0000000-0000-4000-8000-000000000021', 'W1', 'd0000000-0000-4000-8000-000000000021', 'active'),
  ('b0000000-0000-4000-8000-000000000022', 'c0000000-0000-4000-8000-000000000022', 'E1', 'd0000000-0000-4000-8000-000000000022', 'active'),
  ('b0000000-0000-4000-8000-000000000023', 'c0000000-0000-4000-8000-000000000023', 'I1', 'd0000000-0000-4000-8000-000000000023', 'active'),
  ('b0000000-0000-4000-8000-000000000024', 'c0000000-0000-4000-8000-000000000023', 'I2', 'd0000000-0000-4000-8000-000000000024', 'active'),
  ('b0000000-0000-4000-8000-000000000025', 'c0000000-0000-4000-8000-000000000023', 'I3', 'd0000000-0000-4000-8000-000000000025', 'active');
select pg_temp.force('b0000000-0000-4000-8000-000000000022', 'paused');
select pg_temp.force('b0000000-0000-4000-8000-000000000024', 'filled');
update public.job_postings jp set closes_at = public.company_today(jp.company_id) - 1
 where id in ('b0000000-0000-4000-8000-000000000021', 'b0000000-0000-4000-8000-000000000022',
              'b0000000-0000-4000-8000-000000000024');
update public.job_postings jp set closes_at = public.company_today(jp.company_id)
 where id = 'b0000000-0000-4000-8000-000000000023';

-- Neither anon nor authenticated may run them.
set local role authenticated;
select pg_temp.act('c1000000-0000-4000-8000-000000000001');
do $$ begin
  assert pg_temp.raises('select * from public.close_due_job_posts()'), 'authenticated ran close_due_job_posts';
  assert pg_temp.raises('select * from public.claim_closing_soon_job_posts(3)'), 'authenticated ran claim_closing_soon_job_posts';
end $$;
reset role;
set local role anon;
select pg_temp.act(null);
do $$ begin
  assert pg_temp.raises('select * from public.close_due_job_posts()'), 'anon ran close_due_job_posts';
end $$;
reset role;

set local role service_role;
do $$
declare v_ids uuid[];
begin
  select array_agg(job_post_id order by title) into v_ids from public.close_due_job_posts()
   where job_post_id::text like 'b0000000-0000-4000-8000-00000000002%';
  assert v_ids = array['b0000000-0000-4000-8000-000000000022', 'b0000000-0000-4000-8000-000000000021']::uuid[],
    'closed: ' || coalesce(v_ids::text, 'none');
end $$;
reset role;
do $$
declare v_ev public.job_post_state_events%rowtype;
begin
  assert pg_temp.st('b0000000-0000-4000-8000-000000000021') = 'closed/inactive/inactive', 'W1: ' || pg_temp.st('b0000000-0000-4000-8000-000000000021');
  assert pg_temp.st('b0000000-0000-4000-8000-000000000022') = 'closed/inactive/inactive', 'E1 (paused) closed';
  assert pg_temp.st('b0000000-0000-4000-8000-000000000023') = 'open/active/active', 'I1 closes today: still open';
  assert pg_temp.st('b0000000-0000-4000-8000-000000000024') = 'filled/inactive/inactive', 'I2 filled: untouched';
  assert pg_temp.st('b0000000-0000-4000-8000-000000000025') = 'open/active/active', 'I3 no date: untouched';
  assert (select close_reason from public.job_postings where id = 'b0000000-0000-4000-8000-000000000021') = 'deadline',
    'W1 close_reason';
  assert (select closed_at from public.job_postings where id = 'b0000000-0000-4000-8000-000000000021') is not null,
    'W1 closed_at';
  select * into v_ev from public.job_post_state_events
   where job_post_id = 'b0000000-0000-4000-8000-000000000022' order by created_at desc limit 1;
  assert v_ev.from_state = 'paused' and v_ev.to_state = 'closed' and v_ev.reason = 'deadline'
     and v_ev.actor_user_id is null, 'E1 event: ' || row_to_json(v_ev)::text;
  assert not exists (select 1 from public.company_audit_log
                      where target_id = 'b0000000-0000-4000-8000-000000000021'), 'a system move wrote the audit log';
end $$;

-- A second run finds nothing more.
set local role service_role;
do $$ begin
  assert not exists (select 1 from public.close_due_job_posts()
                      where job_post_id::text like 'b0000000-0000-4000-8000-00000000002%'), 'closed twice';
end $$;
reset role;

-- ====================================================== block 12: the reminder (JLT-045)
-- I1 closes today and I3 in 3 days; I4, in 4 days, is left out.

update public.job_postings jp set closes_at = public.company_today(jp.company_id) + 3
 where id = 'b0000000-0000-4000-8000-000000000025';
insert into public.all_jobs (id, job_name, job_url, company_name, platform, status) values
  ('d0000000-0000-4000-8000-000000000026', 'I4', 'https://acme.test/jobs/26', 'India', 'gethired', 'active');
insert into public.job_postings (id, company_id, title, job_id, status) values
  ('b0000000-0000-4000-8000-000000000026', 'c0000000-0000-4000-8000-000000000023', 'I4', 'd0000000-0000-4000-8000-000000000026', 'active');
update public.job_postings jp set closes_at = public.company_today(jp.company_id) + 4
 where id = 'b0000000-0000-4000-8000-000000000026';

set local role service_role;
do $$
declare v_ids uuid[];
begin
  select array_agg(job_post_id order by title) into v_ids from public.claim_closing_soon_job_posts(3)
   where job_post_id::text like 'b0000000-0000-4000-8000-00000000002%';
  assert v_ids = array['b0000000-0000-4000-8000-000000000023', 'b0000000-0000-4000-8000-000000000025']::uuid[],
    'reminded: ' || coalesce(v_ids::text, 'none');
  assert not exists (select 1 from public.claim_closing_soon_job_posts(3)
                      where job_post_id::text like 'b0000000-0000-4000-8000-00000000002%'), 'reminded twice';
end $$;
reset role;

-- Moving the date clears the mark, so the new date is reminded again.
update public.job_postings jp set closes_at = public.company_today(jp.company_id) + 2
 where id = 'b0000000-0000-4000-8000-000000000025';
do $$ begin
  assert (select closes_reminder_sent_at from public.job_postings
           where id = 'b0000000-0000-4000-8000-000000000025') is null, 'moving the date kept the reminder mark';
  assert (select closes_reminder_sent_at from public.job_postings
           where id = 'b0000000-0000-4000-8000-000000000023') is not null, 'I1 lost its mark';
end $$;
set local role service_role;
do $$ begin
  assert (select array_agg(job_post_id) from public.claim_closing_soon_job_posts(3)
           where job_post_id::text like 'b0000000-0000-4000-8000-00000000002%')
         = array['b0000000-0000-4000-8000-000000000025']::uuid[], 'the moved date wasn''t reminded';
end $$;
reset role;

-- ====================================================== block 13: approval (JLT-051)
-- Scoped jobs.approve opens that job directly; approving checks the limit;
-- turning approval off leaves a pending job pending.

insert into auth.users (id, email, aud, role, email_confirmed_at, raw_user_meta_data) values
  ('c8000000-0000-4000-8000-000000000002', 'scoped-approver@acme.test', 'authenticated', 'authenticated', now(), '{}');
insert into public.all_jobs (id, job_name, job_url, company_name, platform, status) values
  ('d0000000-0000-4000-8000-000000000004', 'A4', 'https://acme.test/jobs/4', 'Acme', 'gethired', 'inactive');
insert into public.job_postings (id, company_id, title, job_id, state) values
  ('b0000000-0000-4000-8000-000000000004', 'c0000000-0000-4000-8000-000000000001', 'A4', 'd0000000-0000-4000-8000-000000000004', 'draft');
do $$
declare
  a uuid := 'c0000000-0000-4000-8000-000000000001';
  v_role uuid;
begin
  insert into public.company_roles (company_id, name) values (a, 'Scoped approver') returning id into v_role;
  insert into public.company_role_permissions (role_id, permission_key, scope) values
    (v_role, 'jobs.view', 'assigned'), (v_role, 'jobs.publish', 'assigned'), (v_role, 'jobs.approve', 'assigned');
  insert into public.company_members (company_id, user_id, role_id, display_name) values
    (a, 'c8000000-0000-4000-8000-000000000002', v_role, 'Sue Scoped');
  insert into public.company_job_assignments (company_id, job_post_id, user_id) values
    (a, 'b0000000-0000-4000-8000-000000000004', 'c8000000-0000-4000-8000-000000000002')
  on conflict do nothing;
end $$;
update public.company_info set job_approval_required = true where id = 'c0000000-0000-4000-8000-000000000001';
select pg_temp.force('b0000000-0000-4000-8000-000000000001', 'draft');

set local role authenticated;
select pg_temp.act('c8000000-0000-4000-8000-000000000002');
do $$ begin
  perform pg_temp.expect(public.set_job_post_state('b0000000-0000-4000-8000-000000000004', 'open'),
    null, 'jobs.approve scoped to A4 opens A4 directly');
  perform pg_temp.expect(public.set_job_post_state('b0000000-0000-4000-8000-000000000001', 'open'),
    'not_found', 'jobs.approve scoped to A4 opens A1');
end $$;

-- Turning approval off leaves a pending job pending (JL-REQ-018).
select pg_temp.act('c7000000-0000-4000-8000-000000000001');
select pg_temp.expect(public.set_job_post_state('b0000000-0000-4000-8000-000000000001', 'pending_approval'),
  null, 'a publisher submits A1');
reset role;
update public.company_info set job_approval_required = false where id = 'c0000000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.act('c7000000-0000-4000-8000-000000000001');
do $$ begin
  assert pg_temp.st('b0000000-0000-4000-8000-000000000001') like 'pending_approval/%',
    'turning approval off moved A1: ' || pg_temp.st('b0000000-0000-4000-8000-000000000001');
  perform pg_temp.expect(public.set_job_post_state('b0000000-0000-4000-8000-000000000001', 'open'),
    'forbidden', 'a publisher opens a pending job with approval off');
  perform pg_temp.expect(public.set_job_post_state('b0000000-0000-4000-8000-000000000001', 'draft'),
    null, 'the submitter withdraws with approval off');
  perform pg_temp.expect(public.set_job_post_state('b0000000-0000-4000-8000-000000000001', 'open'),
    null, 'then publishes directly');
end $$;
reset role;

-- Approving checks the limit. Globex is on Free (2 active posts): B3 open,
-- B1 paused, B4 a draft.
update public.company_info set job_approval_required = true where id = 'c0000000-0000-4000-8000-000000000002';
set local role authenticated;
select pg_temp.act('c1000000-0000-4000-8000-000000000002');
do $$ begin
  assert pg_temp.st('b0000000-0000-4000-8000-000000000013') like 'open/%', 'B3 should be open';
  assert pg_temp.st('b0000000-0000-4000-8000-000000000011') like 'paused/%', 'B1 should be paused';
  perform pg_temp.expect(public.set_job_post_state('b0000000-0000-4000-8000-000000000011', 'open'),
    null, 'a reopen needs no approval (Globex)');
  perform pg_temp.expect(public.set_job_post_state('b0000000-0000-4000-8000-000000000014', 'pending_approval'),
    null, 'submit B4');
  perform pg_temp.expect(public.set_job_post_state('b0000000-0000-4000-8000-000000000014', 'open'),
    'active_job_posts', 'approve over the limit');
  assert pg_temp.st('b0000000-0000-4000-8000-000000000014') like 'pending_approval/%', 'a refused approval moved B4';
  perform pg_temp.expect(public.set_job_post_state('b0000000-0000-4000-8000-000000000013', 'paused'), null, 'free a slot');
  perform pg_temp.expect(public.set_job_post_state('b0000000-0000-4000-8000-000000000014', 'open'),
    null, 'approve with a free slot');
  assert pg_temp.st('b0000000-0000-4000-8000-000000000014') = 'open/active/active', 'B4: ' || pg_temp.st('b0000000-0000-4000-8000-000000000014');
end $$;
reset role;

-- ====================================================== block 14: link-only (JLT-060)
-- The trigger mirrors visibility to all_jobs.listed; the careers list and the
-- filter option lists leave a link-only job out.
do $$
declare
  v_list jsonb;
begin
  assert (select listed from public.all_jobs where id = 'd0000000-0000-4000-8000-000000000011'), 'B1 starts listed';

  update public.job_postings set visibility = 'link_only' where id = 'b0000000-0000-4000-8000-000000000011';
  assert not (select listed from public.all_jobs where id = 'd0000000-0000-4000-8000-000000000011'),
    'link_only unlists the public row';
  assert (select listed from public.all_jobs where id = 'd0000000-0000-4000-8000-000000000012'),
    'another job stays listed';

  update public.company_info set careers_slug = 'globex-test', careers_published = true
   where id = 'c0000000-0000-4000-8000-000000000002';
  v_list := public.get_careers_jobs('globex-test');
  assert not exists (select 1 from jsonb_array_elements(v_list) e where e->>'id' = 'b0000000-0000-4000-8000-000000000011'),
    'the careers list drops a link-only job';
  assert exists (select 1 from jsonb_array_elements(v_list) e where e->>'id' = 'b0000000-0000-4000-8000-000000000012'),
    'the careers list keeps a public job';

  update public.job_postings set visibility = 'public' where id = 'b0000000-0000-4000-8000-000000000011';
  assert (select listed from public.all_jobs where id = 'd0000000-0000-4000-8000-000000000011'),
    'public lists it again';

  -- Linking a posting to its public row (the first opening) mirrors it too.
  update public.job_postings set job_id = null where id = 'b0000000-0000-4000-8000-000000000014';
  update public.job_postings set visibility = 'link_only' where id = 'b0000000-0000-4000-8000-000000000014';
  update public.job_postings set job_id = 'd0000000-0000-4000-8000-000000000014' where id = 'b0000000-0000-4000-8000-000000000014';
  assert not (select listed from public.all_jobs where id = 'd0000000-0000-4000-8000-000000000014'),
    'linking a link-only posting leaves its row unlisted';
end $$;

select 'job_states: ok';

rollback;
