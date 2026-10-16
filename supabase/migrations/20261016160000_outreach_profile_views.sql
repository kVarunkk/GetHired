-- Recruiter outreach, part 3 (OR-TASK-020, ORT-051): profile views.
-- One row per (company, candidate, day). Written only by record_profile_view;
-- the candidate reads a count of distinct companies through
-- get_my_profile_view_count. No one selects the table directly, so company
-- names never reach the candidate (OR-DEC-002).
-- Tests: supabase/tests/recruiter_outreach.sql, block 3.

create table if not exists public.candidate_profile_views (
  company_id uuid not null references public.company_info(id) on delete cascade,
  candidate_user_id uuid not null references auth.users(id) on delete cascade,
  viewed_on date not null default current_date,
  views smallint not null default 1,
  primary key (company_id, candidate_user_id, viewed_on)
);
create index if not exists candidate_profile_views_candidate_idx
  on public.candidate_profile_views (candidate_user_id, viewed_on);

alter table public.candidate_profile_views enable row level security;
revoke all on public.candidate_profile_views from anon, authenticated;

-- Silently does nothing for a non-company caller, the candidate themselves,
-- or a candidate the company can't see.
create or replace function public.record_profile_view(p_candidate uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_company uuid := public.my_company_id();
begin
  if v_company is null or p_candidate is null or p_candidate = auth.uid() then
    return;
  end if;
  if not public.company_can_view_candidate(p_candidate) then
    return;
  end if;

  insert into public.candidate_profile_views (company_id, candidate_user_id, viewed_on, views)
  values (v_company, p_candidate, current_date, 1)
  on conflict (company_id, candidate_user_id, viewed_on)
  do update set views = least(public.candidate_profile_views.views + 1, 32767);
end $$;

-- Distinct companies that viewed the caller in the last p_days days (1..365).
create or replace function public.get_my_profile_view_count(p_days integer default 30)
returns integer
language sql stable security definer
set search_path = ''
as $$
  select count(distinct v.company_id)::int
  from public.candidate_profile_views v
  where v.candidate_user_id = auth.uid()
    and v.viewed_on > current_date - least(greatest(coalesce(p_days, 30), 1), 365)
$$;

revoke all on function public.record_profile_view(uuid) from public, anon;
revoke all on function public.get_my_profile_view_count(integer) from public, anon;
grant execute on function public.record_profile_view(uuid) to authenticated;
grant execute on function public.get_my_profile_view_count(integer) to authenticated;
