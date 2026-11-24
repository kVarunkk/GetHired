-- Application tracker (plan/application-tracker/feature-application-tracker-tasks.md,
-- ATT-010; migration 20261125130000_application_tracker.sql).
--   block 1  enum values and column CHECKs
--   block 2  unique indexes per user (all_jobs_id, job_url_key)
--   block 3  RLS: owner CRUD; another applicant and a company user see nothing
--   block 4  the guard trigger: locked columns, the cap, status_changed_at, saved rules
--   block 5  tracked_application_events and applicant_application_notes
--   block 6  migration B: the external applications move (AT-TEST-011)
-- Runs in a transaction that always rolls back, so it's safe against the
-- linked project once the migration is applied:
--   npx supabase db query --linked -f supabase/tests/application_tracker.sql
-- Any failed check raises an exception; success prints 'application_tracker: ok'.

begin;

create function pg_temp.act(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
    case when p_user is null then '' else json_build_object('sub', p_user, 'role', 'authenticated')::text end, true)
$$;
-- Whether `sql` raises, as the current role.
create function pg_temp.raises(p_sql text) returns boolean language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when others then
  return true;
end $$;
-- The error message `sql` raises, or null.
create function pg_temp.error_of(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end $$;
grant execute on function pg_temp.act(uuid), pg_temp.raises(text), pg_temp.error_of(text) to authenticated, anon;

-- Seed: Ada and Bob (applicants), HR at Acme (company owner). Ada has a
-- GetHired application to an Acme job; Bob has one too.
insert into auth.users (id, email, aud, role, email_confirmed_at, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000000001', 'ada@applicant.test', 'authenticated', 'authenticated', now(), '{}'),
  ('a0000000-0000-4000-8000-000000000002', 'bob@applicant.test', 'authenticated', 'authenticated', now(), '{}'),
  ('c1000000-0000-4000-8000-000000000001', 'hr@acme.test', 'authenticated', 'authenticated', now(), '{}');

insert into public.company_info (id, user_id, name, email) values
  ('c0000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'Acme', 'hr@acme.test');

insert into public.all_jobs (id, job_name, job_url, company_name, platform, is_platform_job) values
  ('d0000000-0000-4000-8000-000000000001', 'Acme job', 'https://acme.test/jobs/1', 'Acme', 'gethired', true),
  ('d0000000-0000-4000-8000-000000000002', 'Other job', 'https://other.test/jobs/1', 'Other', 'linkedin', false),
  ('d0000000-0000-4000-8000-000000000003', 'Third job', 'https://other.test/jobs/2', 'Other', 'linkedin', false);

insert into public.job_postings (id, company_id, title, job_id) values
  ('b0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'Acme job', 'd0000000-0000-4000-8000-000000000001');

insert into public.applications (id, applicant_user_id, job_post_id, all_jobs_id) values
  ('e0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001',
   'b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001'),
  ('e0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002',
   'b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001');

-- ------------------------------------------------------------- block 1
-- Enum values and column CHECKs.
do $$
declare
  v_labels text[];
  base text := 'insert into public.tracked_applications (user_id, job_title, company_name, source%s) values (''a0000000-0000-4000-8000-000000000001'', %s, %s, ''manual''%s)';
begin
  select array_agg(enumlabel::text order by enumsortorder) into v_labels
    from pg_enum where enumtypid = 'public.tracked_application_status'::regtype;
  assert v_labels = array['saved','applied','in_review','interviewing','offer','accepted','rejected','withdrawn','ghosted'],
    format('1.1 enum: %s', v_labels);

  assert pg_temp.raises(format(base, '', quote_literal(''), '''Acme''', '')), '1.2 empty title accepted';
  assert pg_temp.raises(format(base, '', quote_literal(repeat('x', 201)), '''Acme''', '')), '1.3 201-char title accepted';
  assert pg_temp.raises(format(base, '', '''Dev''', quote_literal(repeat('x', 201)), '')), '1.4 201-char company accepted';
  assert pg_temp.raises(format(base, ', job_url', '''Dev''', '''Acme''', ', ''http://acme.test/1''')), '1.5 http url accepted';
  assert pg_temp.raises(format(base, ', job_url', '''Dev''', '''Acme''', ', ' || quote_literal('https://a.test/' || repeat('x', 2040)))), '1.6 long url accepted';
  assert pg_temp.raises(format(base, ', salary_currency', '''Dev''', '''Acme''', ', ''₹''')), '1.7 symbol currency accepted';
  assert pg_temp.raises(format(base, ', notes', '''Dev''', '''Acme''', ', ' || quote_literal(repeat('x', 5001)))), '1.8 long notes accepted';
  assert pg_temp.raises(format(base, ', location', '''Dev''', '''Acme''', ', ' || quote_literal(repeat('x', 201)))), '1.9 long location accepted';
  assert pg_temp.raises(
    'insert into public.tracked_applications (user_id, job_title, company_name, source) values (''a0000000-0000-4000-8000-000000000001'', ''Dev'', ''Acme'', ''import'')'),
    '1.10 unknown source accepted';
  assert not pg_temp.raises(format(base, ', job_url, salary_currency', '''Dev''', '''Acme''', ', ''https://acme.test/1'', ''INR''')),
    '1.11 a valid row refused';
end $$;

-- ------------------------------------------------------------- block 2
-- One card per job and per URL, per user.
do $$
begin
  insert into public.tracked_applications (user_id, all_jobs_id, job_title, company_name, source, job_url_key) values
    ('a0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000002', 'Other job', 'Other', 'manual', 'other.test/jobs/1');
  assert pg_temp.raises(
    'insert into public.tracked_applications (user_id, all_jobs_id, job_title, company_name, source) values (''a0000000-0000-4000-8000-000000000001'', ''d0000000-0000-4000-8000-000000000002'', ''Other job'', ''Other'', ''manual'')'),
    '2.1 duplicate all_jobs_id accepted';
  assert pg_temp.raises(
    'insert into public.tracked_applications (user_id, job_title, company_name, source, job_url_key) values (''a0000000-0000-4000-8000-000000000001'', ''Other job'', ''Other'', ''manual'', ''other.test/jobs/1'')'),
    '2.2 duplicate job_url_key accepted';
  -- Another user can track the same job.
  insert into public.tracked_applications (user_id, all_jobs_id, job_title, company_name, source, job_url_key) values
    ('a0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000002', 'Other job', 'Other', 'manual', 'other.test/jobs/1');
  -- Nulls don't collide.
  insert into public.tracked_applications (user_id, job_title, company_name, source) values
    ('a0000000-0000-4000-8000-000000000001', 'No link 1', 'X', 'manual'),
    ('a0000000-0000-4000-8000-000000000001', 'No link 2', 'X', 'manual');
end $$;

-- ------------------------------------------------------------- block 3
-- RLS. Ada owns her rows; Bob and HR see and change nothing of hers.
set local role authenticated;
select pg_temp.act('a0000000-0000-4000-8000-000000000001');
do $$
declare
  v_id uuid;
  v_n int;
begin
  insert into public.tracked_applications (job_title, company_name, source) values ('Mine', 'Me Inc', 'manual')
    returning id into v_id;
  assert (select user_id from public.tracked_applications where id = v_id) = 'a0000000-0000-4000-8000-000000000001',
    '3.1 user_id default';
  update public.tracked_applications set notes = 'ok' where id = v_id;
  assert (select notes from public.tracked_applications where id = v_id) = 'ok', '3.2 owner update';
  select count(*) into v_n from public.tracked_applications;
  assert v_n = (select count(*) from public.tracked_applications where user_id = 'a0000000-0000-4000-8000-000000000001'),
    '3.3 Ada sees someone else''s rows';
  assert pg_temp.raises(
    'insert into public.tracked_applications (user_id, job_title, company_name, source) values (''a0000000-0000-4000-8000-000000000002'', ''Planted'', ''X'', ''manual'')'),
    '3.4 inserted a row for another user';
  delete from public.tracked_applications where id = v_id;
  assert not exists (select 1 from public.tracked_applications where id = v_id), '3.5 owner delete';
end $$;

select pg_temp.act('a0000000-0000-4000-8000-000000000002');
do $$
declare v_n int;
begin
  select count(*) into v_n from public.tracked_applications where user_id = 'a0000000-0000-4000-8000-000000000001';
  assert v_n = 0, '3.6 Bob reads Ada''s rows';
  update public.tracked_applications set notes = 'hacked' where user_id = 'a0000000-0000-4000-8000-000000000001';
  get diagnostics v_n = row_count;
  assert v_n = 0, '3.7 Bob updated Ada''s rows';
  delete from public.tracked_applications where user_id = 'a0000000-0000-4000-8000-000000000001';
  get diagnostics v_n = row_count;
  assert v_n = 0, '3.8 Bob deleted Ada''s rows';
end $$;

select pg_temp.act('c1000000-0000-4000-8000-000000000001');
do $$
begin
  assert not exists (select 1 from public.tracked_applications), '3.9 a company user reads tracked rows';
  assert not exists (select 1 from public.tracked_application_events), '3.10 a company user reads events';
end $$;

select pg_temp.act(null);
set local role anon;
do $$
begin
  assert pg_temp.raises('select 1 from public.tracked_applications'), '3.11 anon can read the table';
end $$;
reset role;

-- ------------------------------------------------------------- block 4
-- The guard trigger.
set local role authenticated;
select pg_temp.act('a0000000-0000-4000-8000-000000000001');
do $$
declare
  v_id uuid;
  v_saved uuid;
  v_row public.tracked_applications%rowtype;
begin
  insert into public.tracked_applications (job_title, company_name, source, applied_at)
  values ('Guarded', 'G', 'manual', '2026-11-01') returning id into v_id;

  assert pg_temp.raises(format('update public.tracked_applications set user_id = %L where id = %L',
    'a0000000-0000-4000-8000-000000000002', v_id)), '4.1 user_id changed';
  assert pg_temp.raises(format('update public.tracked_applications set source = %L where id = %L', 'agent', v_id)),
    '4.2 source changed';
  assert pg_temp.raises(format('update public.tracked_applications set created_at = now() - interval ''1 year'' where id = %L', v_id)),
    '4.3 created_at changed';

  -- status_changed_at only moves on a status change.
  update public.tracked_applications set status_changed_at = '2020-01-01' where id = v_id;
  select * into v_row from public.tracked_applications where id = v_id;
  assert v_row.status_changed_at > '2020-01-02', '4.4 status_changed_at written directly';
  update public.tracked_applications set status_changed_at = '2020-01-01', notes = 'n' where id = v_id;
  assert (select status_changed_at from public.tracked_applications where id = v_id) = v_row.status_changed_at,
    '4.5 status_changed_at moved on a notes edit';
  update public.tracked_applications set status = 'interviewing' where id = v_id;
  select * into v_row from public.tracked_applications where id = v_id;
  assert v_row.status = 'interviewing', '4.6 status change';
  assert v_row.applied_at = '2026-11-01', '4.7 applied_at kept on a status change';
  assert pg_temp.raises(format('update public.tracked_applications set status = ''saved'' where id = %L', v_id)),
    '4.7b an applied row moved to saved';
end $$;

-- saved (AT-TEST-012).
do $$
declare
  v_saved uuid;
  v_row public.tracked_applications%rowtype;
begin
  insert into public.tracked_applications (job_title, company_name, source, status, applied_at)
  values ('Saved job', 'S', 'url', 'saved', '2026-11-01') returning id into v_saved;
  assert (select applied_at from public.tracked_applications where id = v_saved) is null, '4.8 a saved row has applied_at';

  assert pg_temp.raises(
    'insert into public.tracked_applications (all_jobs_id, job_title, company_name, source, status) values (''d0000000-0000-4000-8000-000000000003'', ''Board'', ''Other'', ''manual'', ''saved'')'),
    '4.9 a saved row with all_jobs_id accepted';

  update public.tracked_applications set status = 'applied' where id = v_saved;
  select * into v_row from public.tracked_applications where id = v_saved;
  assert v_row.applied_at = current_date, format('4.10 applied_at on the move out of saved: %s', v_row.applied_at);
  assert exists (select 1 from public.tracked_application_events where tracked_application_id = v_saved
                  and kind = 'status' and from_status = 'saved' and to_status = 'applied'), '4.11 saved→applied event';

  assert pg_temp.raises(format('update public.tracked_applications set status = ''saved'' where id = %L', v_saved)),
    '4.12 moved back to saved';
  assert pg_temp.raises(format('update public.tracked_applications set applied_at = null where id = %L', v_saved)),
    '4.13 applied_at cleared on an applied row';
end $$;
reset role;

-- The cap: the 2001st row is refused.
do $$
declare
  v_have int;
  v_err text;
begin
  select count(*) into v_have from public.tracked_applications where user_id = 'a0000000-0000-4000-8000-000000000002';
  insert into public.tracked_applications (user_id, job_title, company_name, source)
  select 'a0000000-0000-4000-8000-000000000002', 'Job ' || n, 'Co', 'manual'
    from generate_series(1, 2000 - v_have) as n;
  v_err := pg_temp.error_of(
    'insert into public.tracked_applications (user_id, job_title, company_name, source) values (''a0000000-0000-4000-8000-000000000002'', ''One more'', ''Co'', ''manual'')');
  assert v_err = 'AT_MAX_TRACKED', format('4.14 cap: %s', v_err);
  delete from public.tracked_applications where user_id = 'a0000000-0000-4000-8000-000000000002' and job_title like 'Job %';
end $$;

-- ------------------------------------------------------------- block 5
-- Events and private notes.
set local role authenticated;
select pg_temp.act('a0000000-0000-4000-8000-000000000001');
do $$
declare
  v_id uuid;
  v_n int;
begin
  insert into public.tracked_applications (job_title, company_name, source) values ('Timeline', 'T', 'agent')
    returning id into v_id;
  assert (select count(*) from public.tracked_application_events where tracked_application_id = v_id and kind = 'created'
           and to_status = 'applied') = 1, '5.1 created event';
  update public.tracked_applications set notes = 'x', next_follow_up_at = current_date + 3 where id = v_id;
  assert (select count(*) from public.tracked_application_events where tracked_application_id = v_id) = 1,
    '5.2 an event on a non-status edit';
  update public.tracked_applications set status = 'in_review' where id = v_id;
  assert (select count(*) from public.tracked_application_events where tracked_application_id = v_id and kind = 'status'
           and from_status = 'applied' and to_status = 'in_review') = 1, '5.3 status event';

  assert pg_temp.raises(format(
    'insert into public.tracked_application_events (tracked_application_id, user_id, kind, to_status) values (%L, %L, ''status'', ''offer'')',
    v_id, 'a0000000-0000-4000-8000-000000000001')), '5.4 a client inserted an event';
  update public.tracked_application_events set to_status = 'offer' where tracked_application_id = v_id;
  get diagnostics v_n = row_count;
  assert v_n = 0, '5.5 a client updated an event';

  -- Notes on Ada's own GetHired application.
  insert into public.applicant_application_notes (application_id, notes, next_follow_up_at)
  values ('e0000000-0000-4000-8000-000000000001', 'Ping HR on Friday', current_date + 2);
  assert (select user_id from public.applicant_application_notes
           where application_id = 'e0000000-0000-4000-8000-000000000001') = 'a0000000-0000-4000-8000-000000000001',
    '5.6 note owner';
  -- Not on Bob's.
  assert pg_temp.raises(
    'insert into public.applicant_application_notes (application_id, user_id, notes) values (''e0000000-0000-4000-8000-000000000002'', ''a0000000-0000-4000-8000-000000000001'', ''x'')'),
    '5.7 a note on someone else''s application';
  assert pg_temp.raises(
    'update public.applicant_application_notes set application_id = ''e0000000-0000-4000-8000-000000000002'' where application_id = ''e0000000-0000-4000-8000-000000000001'''),
    '5.8 a note moved to another application';
end $$;

select pg_temp.act('a0000000-0000-4000-8000-000000000002');
do $$
begin
  assert not exists (select 1 from public.applicant_application_notes), '5.9 Bob reads Ada''s note';
  assert not exists (select 1 from public.tracked_application_events
                      where user_id = 'a0000000-0000-4000-8000-000000000001'), '5.10 Bob reads Ada''s events';
end $$;

-- HR owns the job Ada applied to and still can't read her note.
select pg_temp.act('c1000000-0000-4000-8000-000000000001');
do $$
begin
  assert exists (select 1 from public.applications where id = 'e0000000-0000-4000-8000-000000000001'),
    '5.11 seed: HR reads the application';
  assert not exists (select 1 from public.applicant_application_notes), '5.12 a company member reads the note';
end $$;
reset role;

-- ------------------------------------------------------------- block 6
-- Migration B (20261126120000_application_tracker_move.sql, AT-TEST-011).
-- Runs as the table owner. Seed external rows (job_post_id null) with every
-- application_status, plus two rows that must stay: a company candidate's
-- and a company application (e0...01, Ada's, from the seed).
insert into public.all_jobs (id, job_name, job_url, company_name, platform, is_platform_job, locations) values
  ('d1000000-0000-4000-8000-000000000001', 'Job submitted', 'https://x.test/jobs/1', 'Co 1', 'linkedin', false, '{Pune,Remote}'),
  ('d1000000-0000-4000-8000-000000000002', 'Job reviewed', null, 'Co 2', 'linkedin', false, '{}'),
  ('d1000000-0000-4000-8000-000000000003', 'Job stand_by', 'http://x.test/jobs/3', 'Co 3', 'linkedin', false, '{Berlin}'),
  ('d1000000-0000-4000-8000-000000000004', 'Job selected', 'https://x.test/jobs/4', 'Co 4', 'linkedin', false, '{Oslo}'),
  ('d1000000-0000-4000-8000-000000000005', 'Job rejected', 'https://x.test/jobs/5', 'Co 5', 'linkedin', false, '{Rome}'),
  ('d1000000-0000-4000-8000-000000000006', 'Job already tracked', 'https://x.test/jobs/6', 'Co 6', 'linkedin', false, '{Lima}'),
  ('d1000000-0000-4000-8000-000000000007', 'Job of a candidate', 'https://x.test/jobs/7', 'Co 7', 'linkedin', false, '{}');

insert into public.company_candidates (id, company_id, full_name, email) values
  ('cc000000-0000-4000-8000-0000000000a1', 'c0000000-0000-4000-8000-000000000001', 'Cand', 'cand@mail.test');

insert into public.applications (id, applicant_user_id, company_candidate_id, job_post_id, all_jobs_id, status, created_at, updated_at) values
  ('f0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', null, null, 'd1000000-0000-4000-8000-000000000001', 'submitted', '2026-10-01 23:30:00+00', '2026-10-02 08:00:00+00'),
  ('f0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', null, null, 'd1000000-0000-4000-8000-000000000002', 'reviewed',  '2026-10-03 10:00:00+00', '2026-10-04 10:00:00+00'),
  ('f0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000001', null, null, 'd1000000-0000-4000-8000-000000000003', 'stand_by',  '2026-10-05 10:00:00+00', '2026-10-06 10:00:00+00'),
  ('f0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000001', null, null, 'd1000000-0000-4000-8000-000000000004', 'selected',  '2026-10-07 10:00:00+00', '2026-10-08 10:00:00+00'),
  ('f0000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000002', null, null, 'd1000000-0000-4000-8000-000000000005', 'rejected',  '2026-10-09 10:00:00+00', '2026-10-10 10:00:00+00'),
  ('f0000000-0000-4000-8000-000000000006', 'a0000000-0000-4000-8000-000000000002', null, null, 'd1000000-0000-4000-8000-000000000006', 'submitted', '2026-10-11 10:00:00+00', '2026-10-11 10:00:00+00'),
  ('f0000000-0000-4000-8000-000000000007', null, 'cc000000-0000-4000-8000-0000000000a1', null, 'd1000000-0000-4000-8000-000000000007', 'submitted', '2026-10-12 10:00:00+00', '2026-10-12 10:00:00+00');

-- Bob already tracks job 6 himself (the app wrote it after the deploy).
insert into public.tracked_applications (user_id, all_jobs_id, job_title, company_name, source)
values ('a0000000-0000-4000-8000-000000000002', 'd1000000-0000-4000-8000-000000000006', 'Bob''s own card', 'Co 6', 'board_prompt');

do $$
declare
  v_first record;
  v_second record;
begin
  select * into v_first from public.move_external_applications_to_tracker();
  assert v_first.moved = 5, '6.1 five rows copied (job 6 was already tracked): ' || v_first.moved;
  assert v_first.removed = 6, '6.2 six originals deleted: ' || v_first.removed;

  -- §7.2 mapping, one case per status.
  assert (select status from public.tracked_applications where all_jobs_id = 'd1000000-0000-4000-8000-000000000001') = 'applied',
    '6.3 submitted -> applied';
  assert (select status from public.tracked_applications where all_jobs_id = 'd1000000-0000-4000-8000-000000000002') = 'in_review',
    '6.4 reviewed -> in_review';
  assert (select status from public.tracked_applications where all_jobs_id = 'd1000000-0000-4000-8000-000000000003') = 'in_review',
    '6.5 stand_by -> in_review';
  assert (select status from public.tracked_applications where all_jobs_id = 'd1000000-0000-4000-8000-000000000004') = 'offer',
    '6.6 selected -> offer';
  assert (select status from public.tracked_applications where all_jobs_id = 'd1000000-0000-4000-8000-000000000005') = 'rejected',
    '6.7 rejected -> rejected';

  -- Copied fields.
  assert (select source from public.tracked_applications where all_jobs_id = 'd1000000-0000-4000-8000-000000000001') = 'migrated',
    '6.8 source migrated';
  assert (select applied_at from public.tracked_applications where all_jobs_id = 'd1000000-0000-4000-8000-000000000001')
           = date '2026-10-01', '6.9 applied_at is the creation date (UTC)';
  assert (select created_at from public.tracked_applications where all_jobs_id = 'd1000000-0000-4000-8000-000000000001')
           = timestamptz '2026-10-01 23:30:00+00', '6.10 created_at kept';
  assert (select status_changed_at from public.tracked_applications where all_jobs_id = 'd1000000-0000-4000-8000-000000000001')
           = timestamptz '2026-10-02 08:00:00+00', '6.11 status_changed_at is the last update';
  assert (select job_title || '|' || company_name || '|' || job_url || '|' || location
            from public.tracked_applications where all_jobs_id = 'd1000000-0000-4000-8000-000000000001')
           = 'Job submitted|Co 1|https://x.test/jobs/1|Pune', '6.12 title, company, url and first location from all_jobs';
  assert (select job_url is null and location is null from public.tracked_applications
           where all_jobs_id = 'd1000000-0000-4000-8000-000000000002'), '6.13 no location, and a missing url stays null';
  assert (select job_url is null from public.tracked_applications where all_jobs_id = 'd1000000-0000-4000-8000-000000000003'),
    '6.14 a non-https url is left out, not copied';
  assert (select count(*) from public.tracked_application_events e
           join public.tracked_applications t on t.id = e.tracked_application_id
          where t.source = 'migrated' and e.kind = 'created') = 5, '6.15 each moved card has its created event';

  -- Bob's own card is untouched, and his old row is gone without a duplicate.
  assert (select count(*) from public.tracked_applications where all_jobs_id = 'd1000000-0000-4000-8000-000000000006') = 1,
    '6.16 no duplicate for an already tracked job';
  assert (select job_title from public.tracked_applications where all_jobs_id = 'd1000000-0000-4000-8000-000000000006') = 'Bob''s own card',
    '6.17 the existing card wins';

  -- The originals are deleted; the others stay.
  assert not exists (select 1 from public.applications where id::text like 'f0000000-%' and applicant_user_id is not null),
    '6.18 the external originals are deleted';
  assert exists (select 1 from public.applications where id = 'f0000000-0000-4000-8000-000000000007'),
    '6.19 a company candidate''s application stays';
  assert exists (select 1 from public.applications where id = 'e0000000-0000-4000-8000-000000000001'),
    '6.20 a company application stays';
  assert not exists (select 1 from public.tracked_applications where all_jobs_id = 'd1000000-0000-4000-8000-000000000007'),
    '6.21 nothing is tracked for a company candidate';

  -- The guard is back on.
  assert (select tgenabled from pg_trigger where tgname = 'tracked_applications_guard') = 'O', '6.22 the guard trigger is enabled again';

  -- Run twice: nothing moves, nothing duplicates.
  select * into v_second from public.move_external_applications_to_tracker();
  assert v_second.moved = 0 and v_second.removed = 0, '6.23 the second run moves nothing';
  assert (select count(*) from public.tracked_applications where source = 'migrated') = 5, '6.24 still five migrated cards';

  -- Only the service role may run it.
  assert not has_function_privilege('authenticated', 'public.move_external_applications_to_tracker()', 'execute'),
    '6.25 not callable by clients';
end $$;

select 'application_tracker: ok';

rollback;
