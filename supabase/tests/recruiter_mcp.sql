-- RMT-011: recruiter tools over MCP, the DB half. Runs in a transaction that
-- always rolls back, so it's safe to run against the linked project once
-- 20261029120000_recruiter_mcp.sql is applied (or with it prepended inside
-- the same transaction):
--   npx supabase db query --linked -f supabase/tests/recruiter_mcp.sql
-- Any failed check raises an exception; success prints 'recruiter_mcp: ok'.

begin;

create function pg_temp.act(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
    case when p_user is null then '' else json_build_object('sub', p_user, 'role', 'authenticated')::text end, true)
$$;
create function pg_temp.role_of(p_company uuid, p_template text) returns uuid language sql as $$
  select id from public.company_roles where company_id = p_company and template_key = p_template
$$;

-- Seed. Company A: owner, Admin, Member and a custom role with only mcp.use;
-- company B: owner.
insert into auth.users (id, email, aud, role, email_confirmed_at, raw_user_meta_data) values
  ('c1000000-0000-4000-8000-000000000001', 'hr@acme.test', 'authenticated', 'authenticated', now(), '{}'),
  ('c1000000-0000-4000-8000-000000000002', 'hr@globex.test', 'authenticated', 'authenticated', now(), '{}'),
  ('c2000000-0000-4000-8000-000000000001', 'admin@acme.test', 'authenticated', 'authenticated', now(), '{}'),
  ('c3000000-0000-4000-8000-000000000001', 'member@acme.test', 'authenticated', 'authenticated', now(), '{}'),
  ('c8000000-0000-4000-8000-000000000001', 'custom@acme.test', 'authenticated', 'authenticated', now(), '{}');

insert into public.company_info (id, user_id, name, email) values
  ('c0000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'Acme', 'hr@acme.test'),
  ('c0000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000002', 'Globex', 'hr@globex.test');

insert into public.company_roles (id, company_id, name, color) values
  ('e0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'MCP only', 'slate');
insert into public.company_role_permissions (role_id, permission_key, scope) values
  ('e0000000-0000-4000-8000-000000000001', 'mcp.use', 'all');

insert into public.company_members (company_id, user_id, role_id, display_name) values
  ('c0000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001',
     pg_temp.role_of('c0000000-0000-4000-8000-000000000001', 'admin'), 'Ada Admin'),
  ('c0000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000001',
     pg_temp.role_of('c0000000-0000-4000-8000-000000000001', 'member'), 'Max Member'),
  ('c0000000-0000-4000-8000-000000000001', 'c8000000-0000-4000-8000-000000000001',
     'e0000000-0000-4000-8000-000000000001', 'Cory Custom');

-- ===================================================== block 1: mcp.use and the call log

-- The catalog row, and the template defaults (§11 Q1).
do $$
declare
  a uuid := 'c0000000-0000-4000-8000-000000000001';
begin
  assert exists (
    select 1 from public.company_permissions where key = 'mcp.use' and not scopable and requires = '{}'
  ), 'mcp.use is missing from the catalog, scopable or has dependencies';

  -- Every Admin role, the live companies' included (the backfill), has it; no Member role does.
  assert not exists (
    select 1 from public.company_roles r
     where r.template_key = 'admin'
       and not exists (select 1 from public.company_role_permissions p where p.role_id = r.id and p.permission_key = 'mcp.use')
  ), 'an Admin role is missing mcp.use';
  assert not exists (
    select 1 from public.company_role_permissions p
      join public.company_roles r on r.id = p.role_id
     where r.template_key = 'member' and p.permission_key = 'mcp.use'
  ), 'a Member role has mcp.use';
  -- Admin is still every key but company.profile (RP-REQ-004).
  assert (select array_agg(permission_key order by permission_key)
            from public.company_role_permissions where role_id = pg_temp.role_of(a, 'admin'))
       = (select array_agg(key order by key) from public.company_permissions where key <> 'company.profile'),
    'Admin grants differ from RP-REQ-004';
end $$;

-- has_company_permission: owner, Admin and the custom role pass; Member doesn't.
do $$
declare
  a uuid := 'c0000000-0000-4000-8000-000000000001';
begin
  perform pg_temp.act('c1000000-0000-4000-8000-000000000001');
  assert public.has_company_permission(a, 'mcp.use'), 'the owner has no mcp.use';
  perform pg_temp.act('c2000000-0000-4000-8000-000000000001');
  assert public.has_company_permission(a, 'mcp.use'), 'the Admin has no mcp.use';
  perform pg_temp.act('c8000000-0000-4000-8000-000000000001');
  assert public.has_company_permission(a, 'mcp.use'), 'the custom role has no mcp.use';
  perform pg_temp.act('c3000000-0000-4000-8000-000000000001');
  assert not public.has_company_permission(a, 'mcp.use'), 'the Member has mcp.use';
  perform pg_temp.act(null);
end $$;

-- The new columns and the index.
do $$
begin
  assert exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'mcp_tool_calls' and column_name = 'company_id'
       and is_nullable = 'YES' and data_type = 'uuid'
  ), 'mcp_tool_calls.company_id is missing or not nullable';
  assert exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'mcp_tool_calls' and column_name = 'email'
       and is_nullable = 'NO' and data_type = 'boolean' and column_default = 'false'
  ), 'mcp_tool_calls.email is missing or has the wrong default';
  assert exists (
    select 1 from pg_constraint
     where conrelid = 'public.mcp_tool_calls'::regclass and contype = 'f'
       and confrelid = 'public.company_info'::regclass and confdeltype = 'c'
  ), 'mcp_tool_calls.company_id does not cascade on company delete';
  assert exists (
    select 1 from pg_indexes
     where schemaname = 'public' and tablename = 'mcp_tool_calls'
       and indexname = 'mcp_tool_calls_company_id_created_at_idx' and indexdef ilike '%where (company_id is not null)%'
  ), 'the partial company index is missing';
end $$;

-- Rows: the Admin, the Member and B's owner each make one call; one applicant-style row has no company.
insert into public.mcp_tool_calls (user_id, client_id, tool, outcome, company_id, email) values
  ('c2000000-0000-4000-8000-000000000001', 'client', 'list_my_jobs', 'ok', 'c0000000-0000-4000-8000-000000000001', false),
  ('c3000000-0000-4000-8000-000000000001', 'client', 'send_outreach', 'ok', 'c0000000-0000-4000-8000-000000000001', true),
  ('c1000000-0000-4000-8000-000000000002', 'client', 'list_my_jobs', 'ok', 'c0000000-0000-4000-8000-000000000002', false),
  ('c3000000-0000-4000-8000-000000000001', 'client', 'search_jobs', 'ok', null, false);

-- RLS as each user.
set local role authenticated;

-- The Admin (audit.view) reads A's rows and their own, nothing of B's.
select pg_temp.act('c2000000-0000-4000-8000-000000000001');
do $$
begin
  assert (select count(*) from public.mcp_tool_calls where company_id = 'c0000000-0000-4000-8000-000000000001') = 2,
    'the Admin does not read their company''s MCP calls';
  assert not exists (select 1 from public.mcp_tool_calls where company_id = 'c0000000-0000-4000-8000-000000000002'),
    'the Admin reads another company''s MCP calls';
  assert not exists (select 1 from public.mcp_tool_calls where company_id is null),
    'the Admin reads a teammate''s calls that have no company';
end $$;

-- The Member (no audit.view) reads only their own rows.
select pg_temp.act('c3000000-0000-4000-8000-000000000001');
do $$
begin
  assert (select count(*) from public.mcp_tool_calls) = 2, 'the Member does not read exactly their own calls';
  assert not exists (
    select 1 from public.mcp_tool_calls where user_id <> 'c3000000-0000-4000-8000-000000000001'
  ), 'the Member reads a teammate''s calls';
end $$;

-- Nobody updates or deletes, and nobody writes a row into another company.
do $$
begin
  begin
    update public.mcp_tool_calls set outcome = 'error';
    raise exception 'a member updated mcp_tool_calls';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.mcp_tool_calls;
    raise exception 'a member deleted from mcp_tool_calls';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.mcp_tool_calls (user_id, client_id, tool, outcome, company_id)
    values ('c3000000-0000-4000-8000-000000000001', 'client', 'list_my_jobs', 'ok', 'c0000000-0000-4000-8000-000000000002');
    raise exception 'a member wrote a call into another company';
  exception when insufficient_privilege then null;
  end;
  -- Their own company is fine.
  insert into public.mcp_tool_calls (user_id, client_id, tool, outcome, company_id)
  values ('c3000000-0000-4000-8000-000000000001', 'client', 'list_my_jobs', 'ok', 'c0000000-0000-4000-8000-000000000001');
end $$;

reset role;
select pg_temp.act(null);

select 'recruiter_mcp: ok' as result;

rollback;
