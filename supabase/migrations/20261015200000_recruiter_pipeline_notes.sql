-- Recruiter pipeline, part 2 (PLT-051, PL-TASK-020): notes and ratings.
-- plan/feature-recruiter-pipeline-spec.md §3.1 and the tasks file's
-- difference 5 (author_name, kept after a member leaves).
--
-- Notes are company-internal (PL-SEC-004): members of the company read them,
-- only the author edits or deletes them, and candidates get nothing.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'candidate_rating') then
    create type public.candidate_rating as enum ('strong_no','no','yes','strong_yes');
  end if;
end $$;

create table if not exists public.candidate_notes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.company_info(id) on delete cascade,
  candidate_user_id uuid not null references auth.users(id) on delete cascade,
  application_id uuid references public.applications(id) on delete cascade,
  author_user_id uuid not null references auth.users(id) on delete cascade,
  author_name text,
  body text not null check (char_length(body) between 1 and 5000),
  rating public.candidate_rating,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists candidate_notes_company_candidate_created_idx
  on public.candidate_notes (company_id, candidate_user_id, created_at desc);
create index if not exists candidate_notes_application_idx
  on public.candidate_notes (application_id) where application_id is not null;

-- A note stays on its company, candidate, application and author; edits only
-- change the body and rating, and bump updated_at.
create or replace function public.guard_candidate_note()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.company_id is distinct from old.company_id
     or new.candidate_user_id is distinct from old.candidate_user_id
     or new.application_id is distinct from old.application_id
     or new.author_user_id is distinct from old.author_user_id then
    raise exception 'A note can''t move.' using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists candidate_notes_guard on public.candidate_notes;
create trigger candidate_notes_guard
  before update on public.candidate_notes
  for each row execute function public.guard_candidate_note();

alter table public.candidate_notes enable row level security;

drop policy if exists "candidate_notes_select_company" on public.candidate_notes;
create policy "candidate_notes_select_company" on public.candidate_notes
  for select to authenticated using (public.is_company_member(company_id));

-- A member writes as themselves, about a candidate who applied to one of the
-- company's jobs (with that application) or one the company can view.
drop policy if exists "candidate_notes_insert_author" on public.candidate_notes;
create policy "candidate_notes_insert_author" on public.candidate_notes
  for insert to authenticated with check (
    public.is_company_member(company_id)
    and author_user_id = (select auth.uid())
    and (
      (application_id is null and public.company_can_view_candidate(candidate_user_id))
      or exists (
        select 1 from public.applications a
        join public.job_postings jp on jp.id = a.job_post_id
        where a.id = application_id
          and a.applicant_user_id = candidate_notes.candidate_user_id
          and jp.company_id = candidate_notes.company_id
      )
    )
  );

drop policy if exists "candidate_notes_update_author" on public.candidate_notes;
create policy "candidate_notes_update_author" on public.candidate_notes
  for update to authenticated
  using (public.is_company_member(company_id) and author_user_id = (select auth.uid()))
  with check (public.is_company_member(company_id) and author_user_id = (select auth.uid()));

drop policy if exists "candidate_notes_delete_author" on public.candidate_notes;
create policy "candidate_notes_delete_author" on public.candidate_notes
  for delete to authenticated
  using (public.is_company_member(company_id) and author_user_id = (select auth.uid()));
