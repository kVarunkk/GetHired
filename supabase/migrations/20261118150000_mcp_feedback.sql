-- Feedback that MCP clients send with the report_feedback tool.
--
-- One row per report: who sent it (user, OAuth client and, for a company
-- caller, the company), what kind it is, which tool it's about, and the text.
-- A user can only insert their own rows; nobody reads them through the API.
-- The team reads them with the service role (dashboard / SQL).

create table if not exists public.mcp_feedback (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid references public.company_info(id) on delete set null,
  client_id text not null,
  category text not null check (
    category in ('bug', 'missing_capability', 'confusing', 'suggestion', 'praise', 'other')
  ),
  tool text check (tool is null or char_length(tool) between 1 and 100),
  message text not null check (char_length(message) between 1 and 4000),
  created_at timestamptz not null default now()
);

create index if not exists mcp_feedback_created_at_idx
  on public.mcp_feedback (created_at desc);
create index if not exists mcp_feedback_user_id_idx
  on public.mcp_feedback (user_id);

alter table public.mcp_feedback enable row level security;

drop policy if exists "mcp_feedback_insert_own" on public.mcp_feedback;
create policy "mcp_feedback_insert_own" on public.mcp_feedback
  for insert to authenticated with check (user_id = (select auth.uid()));

revoke all on public.mcp_feedback from anon, authenticated;
grant insert on public.mcp_feedback to authenticated;
grant all on public.mcp_feedback to service_role;
