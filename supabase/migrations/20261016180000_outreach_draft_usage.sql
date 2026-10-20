-- Recruiter outreach, part 5 (OR-TASK-040, ORT-071): the AI draft's daily
-- limit (OR-GUD-001: free, 20 per company per day). A counter in the DB,
-- because PostHog isn't a limiter.
-- Tests: supabase/tests/recruiter_outreach.sql, block 5.

create table if not exists public.outreach_draft_usage (
  company_id uuid not null references public.company_info(id) on delete cascade,
  day date not null default current_date,
  count integer not null default 0,
  primary key (company_id, day)
);

alter table public.outreach_draft_usage enable row level security;
revoke all on public.outreach_draft_usage from anon, authenticated;

-- Adds one draft for the caller's company today and returns today's count.
-- Atomic, so parallel drafts can't skip past the limit. NOT_MEMBER for a
-- non-company caller.
create or replace function public.increment_outreach_drafts()
returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_company uuid := public.my_company_id();
  v_count integer;
begin
  if v_company is null then
    raise exception using errcode = 'P0001', message = 'NOT_MEMBER';
  end if;
  insert into public.outreach_draft_usage (company_id, day, count)
  values (v_company, current_date, 1)
  on conflict (company_id, day) do update set count = public.outreach_draft_usage.count + 1
  returning count into v_count;
  return v_count;
end $$;

revoke all on function public.increment_outreach_drafts() from public, anon;
grant execute on function public.increment_outreach_drafts() to authenticated;
