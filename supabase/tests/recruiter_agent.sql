-- RAT-010: the recruiter agent's session role and job summaries. Runs in a
-- transaction that always rolls back:
--   npx supabase db query --linked -f supabase/tests/recruiter_agent.sql
-- It needs 20261015150000_agent_roles.sql applied first. Any failed check
-- raises an exception; success prints 'recruiter_agent: ok'.
-- Ids match test/utils/recruiter.ts.

begin;

insert into auth.users (id, email, aud, role) values
  ('c1000000-0000-4000-8000-000000000001', 'hr@acme.test', 'authenticated', 'authenticated'),
  ('c1000000-0000-4000-8000-000000000002', 'hr@globex.test', 'authenticated', 'authenticated'),
  ('a0000000-0000-4000-8000-000000000001', 'public@applicant.test', 'authenticated', 'authenticated');

insert into public.company_info (id, user_id, name, email) values
  ('c0000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'Acme', 'hr@acme.test'),
  ('c0000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000002', 'Globex', 'hr@globex.test');

insert into public.user_info (user_id, email, full_name, is_public, filled) values
  ('a0000000-0000-4000-8000-000000000001', 'public@applicant.test', 'Public', true, true);

-- Acme: an old active job, a newer inactive one, a newest inactive one. Globex: one job.
insert into public.job_postings (id, company_id, title, status, updated_at) values
  ('b0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'Old active', 'active', now() - interval '10 days'),
  ('b0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001', 'Newer inactive', 'inactive', now() - interval '2 days'),
  ('b0000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000001', 'Newest inactive', 'inactive', now() - interval '1 day'),
  ('b0000000-0000-4000-8000-000000000004', 'c0000000-0000-4000-8000-000000000002', 'Globex job', 'active', now());

-- Two applications to the active job: one today, one last week.
insert into public.applications (id, applicant_user_id, job_post_id, status, created_at) values
  ('e0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'submitted', now() - interval '1 hour'),
  ('e0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'reviewed', now() - interval '7 days');

-- ---------------------------------------------------------- agent_sessions.role
do $$
declare
  r text;
begin
  insert into public.agent_sessions (id, user_id)
    values ('f0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001')
    returning role into r;
  if r <> 'applicant' then raise exception 'role defaulted to %', r; end if;

  insert into public.agent_sessions (user_id, role)
    values ('c1000000-0000-4000-8000-000000000001', 'company');

  begin
    insert into public.agent_sessions (user_id, role)
      values ('c1000000-0000-4000-8000-000000000001', 'admin');
    raise exception 'role admin was accepted';
  exception when check_violation then null;
  end;
end $$;

-- ---------------------------------------------------------------- company A
select set_config('request.jwt.claims', '{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  rows jsonb;
  first jsonb;
begin
  select jsonb_agg(to_jsonb(s)) into rows
    from public.get_recruiter_job_summaries('c0000000-0000-4000-8000-000000000001', null, 15) s;

  if jsonb_array_length(rows) <> 3 then
    raise exception 'expected 3 jobs for Acme, got %', jsonb_array_length(rows);
  end if;
  -- Active first, then by updated_at desc.
  if rows->0->>'title' <> 'Old active' or rows->1->>'title' <> 'Newest inactive'
     or rows->2->>'title' <> 'Newer inactive' then
    raise exception 'wrong order: %', rows;
  end if;

  first := rows->0;
  if (first->>'applicants')::int <> 2 or (first->>'new_24h')::int <> 1 then
    raise exception 'wrong counts: %', first;
  end if;
  if rows->1->>'applicants' <> '0' then raise exception 'job with no applications: %', rows->1; end if;

  select jsonb_agg(to_jsonb(s)) into rows
    from public.get_recruiter_job_summaries('c0000000-0000-4000-8000-000000000001', null, 2) s;
  if jsonb_array_length(rows) <> 2 then raise exception 'p_limit ignored'; end if;

  select jsonb_agg(to_jsonb(s)) into rows
    from public.get_recruiter_job_summaries('c0000000-0000-4000-8000-000000000001', 'inactive', 15) s;
  if jsonb_array_length(rows) <> 2 or rows @> '[{"status":"active"}]' then
    raise exception 'p_status ignored: %', rows;
  end if;

  begin
    perform * from public.get_recruiter_job_summaries('c0000000-0000-4000-8000-000000000002', null, 15);
    raise exception 'company A read the jobs of company B';
  exception when insufficient_privilege then null;
  end;
end $$;

-- --------------------------------------------------------------------- anon
reset role;
set local role anon;

do $$
begin
  begin
    perform * from public.get_recruiter_job_summaries('c0000000-0000-4000-8000-000000000001', null, 15);
    raise exception 'anon could call get_recruiter_job_summaries';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
select 'recruiter_agent: ok';

rollback;
