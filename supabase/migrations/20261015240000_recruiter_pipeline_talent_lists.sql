-- Recruiter pipeline, part 6 (PLT-090, PL-TASK-051): talent lists.
--
-- Named lists of candidates ("Backend shortlist"). RLS goes through the
-- list's company (PL-SEC-001). A member can only be a candidate the company
-- can view (company_can_view_candidate). Members reference user_info, not
-- auth.users, so the profiles query can join them for the saved tab's filter.

create table if not exists public.talent_lists (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.company_info(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  created_at timestamptz not null default now()
);
create index if not exists talent_lists_company_idx on public.talent_lists (company_id, created_at);

create table if not exists public.talent_list_members (
  list_id uuid not null references public.talent_lists(id) on delete cascade,
  candidate_user_id uuid not null references public.user_info(user_id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (list_id, candidate_user_id)
);
create index if not exists talent_list_members_candidate_idx on public.talent_list_members (candidate_user_id);

alter table public.talent_lists enable row level security;
alter table public.talent_list_members enable row level security;

drop policy if exists "talent_lists_select_company" on public.talent_lists;
create policy "talent_lists_select_company" on public.talent_lists
  for select to authenticated using (public.is_company_member(company_id));
drop policy if exists "talent_lists_insert_company" on public.talent_lists;
create policy "talent_lists_insert_company" on public.talent_lists
  for insert to authenticated with check (public.is_company_member(company_id));
drop policy if exists "talent_lists_update_company" on public.talent_lists;
create policy "talent_lists_update_company" on public.talent_lists
  for update to authenticated
  using (public.is_company_member(company_id))
  with check (public.is_company_member(company_id));
drop policy if exists "talent_lists_delete_company" on public.talent_lists;
create policy "talent_lists_delete_company" on public.talent_lists
  for delete to authenticated using (public.is_company_member(company_id));

-- The list's company, for the member policies.
create or replace function public.talent_list_company(p_list_id uuid)
returns uuid
language sql stable security definer set search_path = ''
as $$
  select company_id from public.talent_lists where id = p_list_id
$$;
revoke all on function public.talent_list_company(uuid) from public, anon;
grant execute on function public.talent_list_company(uuid) to authenticated, service_role;

drop policy if exists "talent_list_members_select_company" on public.talent_list_members;
create policy "talent_list_members_select_company" on public.talent_list_members
  for select to authenticated using (public.is_company_member(public.talent_list_company(list_id)));
drop policy if exists "talent_list_members_insert_company" on public.talent_list_members;
create policy "talent_list_members_insert_company" on public.talent_list_members
  for insert to authenticated with check (
    public.is_company_member(public.talent_list_company(list_id))
    and public.company_can_view_candidate(candidate_user_id)
  );
drop policy if exists "talent_list_members_delete_company" on public.talent_list_members;
create policy "talent_list_members_delete_company" on public.talent_list_members
  for delete to authenticated using (public.is_company_member(public.talent_list_company(list_id)));
