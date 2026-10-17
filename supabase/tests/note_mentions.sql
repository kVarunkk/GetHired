-- TMT-070..071: note mentions. Runs in a transaction that always rolls back,
-- so it's safe to run against the linked project once
-- 20261017180000_note_mentions.sql is applied (or with it prepended inside the
-- same transaction):
--   npx supabase db query --linked -f supabase/tests/note_mentions.sql
-- Any failed check raises an exception; success prints 'note_mentions: ok'.
-- Ids match supabase/tests/recruiter_roles.sql.

begin;

create function pg_temp.act(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
    case when p_user is null then '' else json_build_object('sub', p_user, 'role', 'authenticated')::text end, true)
$$;
create function pg_temp.role_of(p_company uuid, p_template text) returns uuid language sql as $$
  select id from public.company_roles where company_id = p_company and template_key = p_template
$$;

-- Seed. Company A: owner (Olive), Member (Max), an Interviewer on job A1 only
-- (Ivy) and a role without notes (Nora); company B: owner.
insert into auth.users (id, email, aud, role, email_confirmed_at, raw_user_meta_data) values
  ('c1000000-0000-4000-8000-000000000001', 'hr@acme.test', 'authenticated', 'authenticated', now(), '{}'),
  ('c1000000-0000-4000-8000-000000000002', 'hr@globex.test', 'authenticated', 'authenticated', now(), '{}'),
  ('c3000000-0000-4000-8000-000000000001', 'member@acme.test', 'authenticated', 'authenticated', now(), '{}'),
  ('c5000000-0000-4000-8000-000000000001', 'ivy@acme.test', 'authenticated', 'authenticated', now(), '{}'),
  ('c8000000-0000-4000-8000-000000000002', 'nora@acme.test', 'authenticated', 'authenticated', now(), '{}'),
  ('a0000000-0000-4000-8000-000000000001', 'public@applicant.test', 'authenticated', 'authenticated', now(), '{}');

insert into public.company_info (id, user_id, name, email) values
  ('c0000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'Acme', 'hr@acme.test'),
  ('c0000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000002', 'Globex', 'hr@globex.test');

update public.company_subscriptions
   set tier_id = (select id from public.company_tiers where slug = 'enterprise'), status = 'active', manual_until = null
 where company_id = 'c0000000-0000-4000-8000-000000000001';

insert into public.user_info (user_id, email, full_name, is_public, filled) values
  ('a0000000-0000-4000-8000-000000000001', 'public@applicant.test', 'Public', true, true);

insert into public.all_jobs (id, job_name, job_url, company_name, platform) values
  ('d0000000-0000-4000-8000-000000000001', 'A1', 'https://acme.test/jobs/1', 'Acme', 'gethired'),
  ('d0000000-0000-4000-8000-000000000003', 'A2', 'https://acme.test/jobs/2', 'Acme', 'gethired');
insert into public.job_postings (id, company_id, title, job_id) values
  ('b0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'A1', 'd0000000-0000-4000-8000-000000000001'),
  ('b0000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000001', 'A2', 'd0000000-0000-4000-8000-000000000003');
insert into public.applications (id, applicant_user_id, job_post_id, all_jobs_id) values
  ('e0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001'),
  ('e0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000003');

do $$
declare
  a uuid := 'c0000000-0000-4000-8000-000000000001';
  r jsonb;
begin
  perform pg_temp.act('c1000000-0000-4000-8000-000000000001');
  r := public.create_company_role('Interviewer', null, 'sky',
    '[{"key":"applicants.view","scope":"assigned"},{"key":"notes.view","scope":"assigned"},{"key":"notes.write","scope":"assigned"}]',
    '{}', 'interviewer');
  assert (r ->> 'ok')::boolean, format('create Interviewer: %s', r);
  insert into public.company_members (company_id, user_id, role_id, display_name) values
    (a, 'c5000000-0000-4000-8000-000000000001', (r ->> 'id')::uuid, 'Ivy Interviewer');
  r := public.create_company_role('Narrow', null, 'slate', '[{"key":"talent.view"}]', '{}', null);
  assert (r ->> 'ok')::boolean, format('create Narrow: %s', r);
  insert into public.company_members (company_id, user_id, role_id, display_name) values
    (a, 'c3000000-0000-4000-8000-000000000001', pg_temp.role_of(a, 'member'), 'Max Member'),
    (a, 'c8000000-0000-4000-8000-000000000002', (r ->> 'id')::uuid, null);
  r := public.assign_job('b0000000-0000-4000-8000-000000000001', 'c5000000-0000-4000-8000-000000000001');
  assert (r ->> 'ok')::boolean, format('assign Ivy to A1: %s', r);
  perform pg_temp.act(null);
end $$;

-- Notes by the owner: on A1 (Ivy's job), on A2, and on the talent-pool candidate.
insert into public.candidate_notes (id, company_id, candidate_user_id, application_id, author_user_id, author_name, body) values
  ('70000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001',
     'e0000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'hr', 'on A1'),
  ('70000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001',
     'e0000000-0000-4000-8000-000000000003', 'c1000000-0000-4000-8000-000000000001', 'hr', 'on A2'),
  ('70000000-0000-4000-8000-000000000009', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001',
     null, 'c1000000-0000-4000-8000-000000000001', 'hr', 'pool');

-- ============================================ list_mentionable_members
do $$
declare names text[];
begin
  -- A member who can write notes sees the team's names (display name, else
  -- the email's local part), owner first, never emails or another company.
  perform pg_temp.act('c3000000-0000-4000-8000-000000000001');
  select array_agg(name) into names from public.list_mentionable_members();
  assert names[1] = 'hr', format('owner first, by email local part: %s', names);
  assert names @> array['Max Member', 'Ivy Interviewer', 'nora'], format('team names: %s', names);
  assert array_length(names, 1) = 4, format('only company A: %s', names);
  assert not exists (select 1 from unnest(names) n where n like '%@%'), 'an email leaked';

  -- Nora can't write notes, so she gets nobody.
  perform pg_temp.act('c8000000-0000-4000-8000-000000000002');
  assert not exists (select 1 from public.list_mentionable_members()), 'a role without notes.write listed the team';

  -- An outsider (B's owner) never sees A.
  perform pg_temp.act('c1000000-0000-4000-8000-000000000002');
  assert not exists (select 1 from public.list_mentionable_members() where name <> 'hr'),
    'B listed A''s members';
  perform pg_temp.act(null);
end $$;

-- The claim RPC is service-role only.
set local role authenticated;
select pg_temp.act('c1000000-0000-4000-8000-000000000001');
do $$
begin
  begin
    perform public.claim_note_mention_emails('70000000-0000-4000-8000-000000000001',
      array['c3000000-0000-4000-8000-000000000001']::uuid[]);
    raise exception 'authenticated called claim_note_mention_emails';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.candidate_note_mentions;
    raise exception 'authenticated read candidate_note_mentions';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
select pg_temp.act(null);

-- ============================================ claim_note_mention_emails
do $$
declare got uuid[];
begin
  -- A1: Max (all), Ivy (assigned to A1); not the author, not Nora (no notes),
  -- not B's owner (another company), not an unknown id.
  select array_agg(x order by x) into got from public.claim_note_mention_emails(
    '70000000-0000-4000-8000-000000000001',
    array['c3000000-0000-4000-8000-000000000001', 'c5000000-0000-4000-8000-000000000001',
          'c1000000-0000-4000-8000-000000000001', 'c8000000-0000-4000-8000-000000000002',
          'c1000000-0000-4000-8000-000000000002', 'c3000000-0000-4000-8000-000000000001',
          'f0000000-0000-4000-8000-000000000000']::uuid[]) x;
  assert got = array['c3000000-0000-4000-8000-000000000001', 'c5000000-0000-4000-8000-000000000001']::uuid[],
    format('A1 claims: %s', got);

  -- Once per note.
  assert not exists (select 1 from public.claim_note_mention_emails('70000000-0000-4000-8000-000000000001',
    array['c3000000-0000-4000-8000-000000000001']::uuid[])), 'emailed twice for one note';

  -- A2 and the pool note: Ivy isn't assigned / needs scope all.
  select array_agg(x) into got from public.claim_note_mention_emails('70000000-0000-4000-8000-000000000003',
    array['c5000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000001']::uuid[]) x;
  assert got = array['c3000000-0000-4000-8000-000000000001']::uuid[], format('A2 claims: %s', got);
  select array_agg(x) into got from public.claim_note_mention_emails('70000000-0000-4000-8000-000000000009',
    array['c5000000-0000-4000-8000-000000000001']::uuid[]) x;
  assert got is null, format('pool note reached an assigned-only member: %s', got);

  -- A removed member isn't emailed.
  delete from public.company_members where user_id = 'c3000000-0000-4000-8000-000000000001';
  select array_agg(x) into got from public.claim_note_mention_emails('70000000-0000-4000-8000-000000000009',
    array['c3000000-0000-4000-8000-000000000001']::uuid[]) x;
  assert got is null, format('a removed member was emailed: %s', got);

  -- Unknown note: nothing.
  assert not exists (select 1 from public.claim_note_mention_emails('70000000-0000-4000-8000-0000000000ff',
    array['c5000000-0000-4000-8000-000000000001']::uuid[])), 'claimed for an unknown note';
end $$;

-- The hourly cap: 20 per company. Three are recorded above; fill to 19 with
-- old-enough-to-count rows, then only one more fits.
with filler as (
  insert into public.candidate_notes (company_id, candidate_user_id, application_id, author_user_id, author_name, body)
  select 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001',
         'e0000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'hr', 'filler'
    from generate_series(1, 16)
  returning id
)
insert into public.candidate_note_mentions (note_id, company_id, mentioned_user_id, created_at)
select id, 'c0000000-0000-4000-8000-000000000001', 'c5000000-0000-4000-8000-000000000001', now() - interval '10 minutes'
  from filler;

do $$
declare
  got uuid[];
  v_note uuid := gen_random_uuid();
begin
  assert (select count(*) from public.candidate_note_mentions
           where company_id = 'c0000000-0000-4000-8000-000000000001') = 19, 'fixture count';
  insert into public.candidate_notes (id, company_id, candidate_user_id, application_id, author_user_id, author_name, body)
  values (v_note, 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001',
          'e0000000-0000-4000-8000-000000000001', 'c5000000-0000-4000-8000-000000000001', 'Ivy', 'cap');
  -- Ivy mentions the owner and B's owner: only the owner, and it's the 20th.
  select array_agg(x) into got from public.claim_note_mention_emails(v_note,
    array['c1000000-0000-4000-8000-000000000001']::uuid[]) x;
  assert got = array['c1000000-0000-4000-8000-000000000001']::uuid[], format('the 20th: %s', got);

  -- Over the cap: nothing, until the window passes.
  insert into public.company_members (company_id, user_id, role_id, display_name) values
    ('c0000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000001',
     pg_temp.role_of('c0000000-0000-4000-8000-000000000001', 'member'), 'Max Member');
  assert not exists (select 1 from public.claim_note_mention_emails(v_note,
    array['c3000000-0000-4000-8000-000000000001']::uuid[])), 'the cap let a 21st through';
  update public.candidate_note_mentions set created_at = now() - interval '2 hours'
   where company_id = 'c0000000-0000-4000-8000-000000000001';
  select array_agg(x) into got from public.claim_note_mention_emails(v_note,
    array['c3000000-0000-4000-8000-000000000001']::uuid[]) x;
  assert got = array['c3000000-0000-4000-8000-000000000001']::uuid[], format('after the window: %s', got);
end $$;

select 'note_mentions: ok' as result;

rollback;
