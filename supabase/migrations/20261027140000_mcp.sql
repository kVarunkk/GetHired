-- MCP server tables (plan/mcp/feature-mcp-spec.md §3, TASK-020).
--
--   1. mcp_confirmations: single-use confirmation ids (MCP-SEC-011). A
--      unique-key violation on insert means "already used".
--   2. mcp_tool_calls: one row per tool call, for the rate limits (§4.7) and
--      auditing.
--   3. RLS and grants: a user inserts and reads only their own rows; nobody
--      updates or deletes them except the cleanup job.
--   4. pg_cron cleanup: confirmations after 1 day, calls after 90 days.
--
-- Only /api/mcp uses these, so nothing deployed reads or writes them.

-- ---------------------------------------------------------------------------
-- 1. Confirmations
-- ---------------------------------------------------------------------------

create table if not exists public.mcp_confirmations (
  jti uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  tool text not null,
  used_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists mcp_confirmations_expires_at_idx
  on public.mcp_confirmations (expires_at);

-- ---------------------------------------------------------------------------
-- 2. Tool-call log
-- ---------------------------------------------------------------------------

create table if not exists public.mcp_tool_calls (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id text not null,
  tool text not null,
  credit boolean not null default false,
  outcome text not null check (
    outcome in ('ok', 'error', 'denied', 'rate_limited', 'needs_confirmation')
  ),
  created_at timestamptz not null default now()
);

create index if not exists mcp_tool_calls_user_id_created_at_idx
  on public.mcp_tool_calls (user_id, created_at desc);
create index if not exists mcp_tool_calls_created_at_idx
  on public.mcp_tool_calls (created_at);

-- ---------------------------------------------------------------------------
-- 3. RLS and grants
-- ---------------------------------------------------------------------------

alter table public.mcp_confirmations enable row level security;
alter table public.mcp_tool_calls enable row level security;

drop policy if exists "mcp_confirmations_select_own" on public.mcp_confirmations;
create policy "mcp_confirmations_select_own" on public.mcp_confirmations
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists "mcp_confirmations_insert_own" on public.mcp_confirmations;
create policy "mcp_confirmations_insert_own" on public.mcp_confirmations
  for insert to authenticated with check (user_id = (select auth.uid()));

drop policy if exists "mcp_tool_calls_select_own" on public.mcp_tool_calls;
create policy "mcp_tool_calls_select_own" on public.mcp_tool_calls
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists "mcp_tool_calls_insert_own" on public.mcp_tool_calls;
create policy "mcp_tool_calls_insert_own" on public.mcp_tool_calls
  for insert to authenticated with check (user_id = (select auth.uid()));

revoke all on public.mcp_confirmations, public.mcp_tool_calls from anon, authenticated;
grant select, insert on public.mcp_confirmations, public.mcp_tool_calls to authenticated;
grant all on public.mcp_confirmations, public.mcp_tool_calls to service_role;

-- ---------------------------------------------------------------------------
-- 4. Cleanup
-- ---------------------------------------------------------------------------

do $$
declare
  existing_job_id bigint;
begin
  select jobid into existing_job_id from cron.job where jobname = 'mcp-cleanup';
  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  perform cron.schedule(
    'mcp-cleanup',
    '17 3 * * *',
    $cleanup$
      delete from public.mcp_confirmations where expires_at < now() - interval '1 day';
      delete from public.mcp_tool_calls where created_at < now() - interval '90 days';
    $cleanup$
  );
end;
$$;
