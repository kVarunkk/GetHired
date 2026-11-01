-- Recruiter tools over MCP (plan/recruiter-mcp/feature-recruiter-mcp-spec.md §3, RMT-012).
--
--   1. mcp.use: its own permission, so an admin can allow the in-app agent
--      without allowing outside AI clients (§4.1). Admin roles get it; the
--      other templates don't (§11 Q1). seed_company_roles gives new Admin
--      roles every catalog key, so it needs no change.
--   2. mcp_tool_calls: company_id (the company a recruiter call ran for) and
--      email (the call counts toward the per-hour email limit, §4.7).
--   3. Members with audit.view read their company's MCP activity (RMCP-SEC-005).
--
-- The company side has no users yet, and only /api/mcp writes mcp_tool_calls,
-- so this can ship before the code (RMCP-CON-004).

-- ---------------------------------------------------------------------------
-- 1. Permission
-- ---------------------------------------------------------------------------

insert into public.company_permissions (key, scopable, requires) values
  ('mcp.use', false, '{}')
on conflict (key) do update set scopable = excluded.scopable, requires = excluded.requires;

-- The Admin template has every permission but company.profile (RP-REQ-004).
insert into public.company_role_permissions (role_id, permission_key, scope)
select r.id, 'mcp.use', 'all'
  from public.company_roles r
 where r.template_key = 'admin'
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 2. Tool-call log columns
-- ---------------------------------------------------------------------------

alter table public.mcp_tool_calls
  add column if not exists company_id uuid references public.company_info(id) on delete cascade,
  add column if not exists email boolean not null default false;

create index if not exists mcp_tool_calls_company_id_created_at_idx
  on public.mcp_tool_calls (company_id, created_at desc)
  where company_id is not null;

-- ---------------------------------------------------------------------------
-- 3. RLS: the company's activity, for audit.view
-- ---------------------------------------------------------------------------

-- A user still reads their own rows through mcp_tool_calls_select_own, and
-- inserts only their own. Nobody updates or deletes (no grant).
drop policy if exists "mcp_tool_calls_select_company_audit" on public.mcp_tool_calls;
create policy "mcp_tool_calls_select_company_audit" on public.mcp_tool_calls
  for select to authenticated
  using (company_id is not null and public.has_company_permission(company_id, 'audit.view'));

-- A row names only a company the user belongs to, so nobody can write into
-- another company's activity.
drop policy if exists "mcp_tool_calls_insert_own" on public.mcp_tool_calls;
create policy "mcp_tool_calls_insert_own" on public.mcp_tool_calls
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (company_id is null or public.is_company_member(company_id))
  );
