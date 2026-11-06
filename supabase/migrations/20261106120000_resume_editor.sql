-- Resume editor (plan/resume-editor/feature-resume-editor-spec.md, RE-REQ-006).
--
-- Additive only (RE-REQ-090): new nullable or defaulted columns, new tables
-- and one new trigger on new columns. It changes no existing column, policy,
-- function or trigger, so the deployed code can't tell. `resume_path` and
-- `parsing_failed` stay until the cleanup release (RE-REQ-099).

-- ---------------------------------------------------------------------------
-- 1. resumes
-- ---------------------------------------------------------------------------

alter table public.resumes
  add column if not exists contact jsonb,
  add column if not exists revision int not null default 1,
  add column if not exists schema_version int not null default 1,
  add column if not exists template text not null default 'classic',
  add column if not exists source_resume_id uuid references public.resumes(id) on delete set null,
  add column if not exists parse_notes jsonb;

-- RE-SEC-004: the owner RLS policy allows direct writes, so size is capped here
-- as well as in saveResume. NOT VALID so that adding them can't fail on an
-- existing row. The limits match RESUME_MAX_CONTENT_BYTES and
-- RESUME_MAX_CONTACT_BYTES (helpers/resume/config.ts).
alter table public.resumes drop constraint if exists resumes_content_size;
alter table public.resumes
  add constraint resumes_content_size
  check (content is null or octet_length(content::text) <= 1000000) not valid;

alter table public.resumes drop constraint if exists resumes_contact_size;
alter table public.resumes
  add constraint resumes_contact_size
  check (contact is null or octet_length(contact::text) <= 20000) not valid;

create index if not exists resumes_source_resume_id_idx
  on public.resumes (source_resume_id) where source_resume_id is not null;

-- ---------------------------------------------------------------------------
-- 2. resume_reviews
-- ---------------------------------------------------------------------------

-- applied_copy_id has no foreign key on purpose. A second relationship between
-- resume_reviews and resumes makes PostgREST's `resumes(...)` embed ambiguous
-- (PGRST201), which would break the deployed review pages the moment this is
-- pushed (RE-REQ-090). The trigger below gives it `on delete set null`.
alter table public.resume_reviews
  add column if not exists resume_revision int,
  add column if not exists applied_copy_id uuid;

create index if not exists resume_reviews_applied_copy_id_idx
  on public.resume_reviews (applied_copy_id) where applied_copy_id is not null;

-- SECURITY DEFINER so it isn't limited by the caller's RLS. It only clears a
-- pointer to the row being deleted.
create or replace function public.clear_resume_applied_copy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.resume_reviews set applied_copy_id = null where applied_copy_id = old.id;
  return old;
end;
$$;

revoke all on function public.clear_resume_applied_copy() from public, anon, authenticated;

drop trigger if exists resumes_clear_applied_copy on public.resumes;
create trigger resumes_clear_applied_copy
  after delete on public.resumes
  for each row execute function public.clear_resume_applied_copy();

-- ---------------------------------------------------------------------------
-- 3. applications: what the company sees (RE-REQ-061)
-- ---------------------------------------------------------------------------

alter table public.applications
  add column if not exists resume_snapshot jsonb,
  add column if not exists resume_contact_snapshot jsonb;

-- Its own trigger, beside applications_protect_submission_columns, rather than
-- a change to that live function. It's also stricter: that one lets company
-- members through, and nobody signed in may rewrite what was sent. The service
-- role and SECURITY DEFINER functions (owner postgres) pass through, as there.
create or replace function public.protect_application_resume_snapshots()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_role <> 'authenticated' then
    return new;
  end if;

  if new.resume_snapshot is distinct from old.resume_snapshot
     or new.resume_contact_snapshot is distinct from old.resume_contact_snapshot then
    raise exception 'A submitted application can''t be changed.'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

drop trigger if exists applications_protect_resume_snapshots on public.applications;
create trigger applications_protect_resume_snapshots
  before update on public.applications
  for each row execute function public.protect_application_resume_snapshots();

-- ---------------------------------------------------------------------------
-- 4. resume_review_applied (RE-REQ-055)
-- ---------------------------------------------------------------------------

-- The primary key stays a surrogate `id`: a composite one holding both foreign
-- keys would make this a join table to PostgREST, and the resume_reviews to
-- resumes embed ambiguous again.
create table if not exists public.resume_review_applied (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.resume_reviews(id) on delete cascade,
  bullet_id text not null,
  target_resume_id uuid not null references public.resumes(id) on delete cascade,
  previous_text text not null,
  applied_text text not null,
  applied_at timestamptz not null default now(),
  unique (review_id, bullet_id, target_resume_id)
);

create index if not exists resume_review_applied_target_idx
  on public.resume_review_applied (target_resume_id);

alter table public.resume_review_applied enable row level security;

revoke all on public.resume_review_applied from anon;
grant select, insert, update, delete on public.resume_review_applied to authenticated;
grant all on public.resume_review_applied to service_role;

-- A row belongs to the user who owns the review. A write must also target one
-- of their own resumes.
drop policy if exists "Users read applied suggestions of their reviews" on public.resume_review_applied;
create policy "Users read applied suggestions of their reviews"
  on public.resume_review_applied for select to authenticated
  using (exists (
    select 1 from public.resume_reviews rr
    where rr.id = review_id and rr.user_id = (select auth.uid())
  ));

drop policy if exists "Users add applied suggestions to their reviews" on public.resume_review_applied;
create policy "Users add applied suggestions to their reviews"
  on public.resume_review_applied for insert to authenticated
  with check (
    exists (
      select 1 from public.resume_reviews rr
      where rr.id = review_id and rr.user_id = (select auth.uid())
    )
    and exists (
      select 1 from public.resumes r
      where r.id = target_resume_id and r.user_id = (select auth.uid())
    )
  );

drop policy if exists "Users change applied suggestions of their reviews" on public.resume_review_applied;
create policy "Users change applied suggestions of their reviews"
  on public.resume_review_applied for update to authenticated
  using (exists (
    select 1 from public.resume_reviews rr
    where rr.id = review_id and rr.user_id = (select auth.uid())
  ))
  with check (
    exists (
      select 1 from public.resume_reviews rr
      where rr.id = review_id and rr.user_id = (select auth.uid())
    )
    and exists (
      select 1 from public.resumes r
      where r.id = target_resume_id and r.user_id = (select auth.uid())
    )
  );

drop policy if exists "Users remove applied suggestions of their reviews" on public.resume_review_applied;
create policy "Users remove applied suggestions of their reviews"
  on public.resume_review_applied for delete to authenticated
  using (exists (
    select 1 from public.resume_reviews rr
    where rr.id = review_id and rr.user_id = (select auth.uid())
  ));

-- ---------------------------------------------------------------------------
-- 5. resume_migration_items (RE-REQ-091)
-- ---------------------------------------------------------------------------

-- `file_path` lets the file deletion run after `resumes.resume_path` is gone,
-- and `resume_id` goes null, not the row, when a resume is deleted, because its
-- file still has to be removed. Only the service role reads this table.
create table if not exists public.resume_migration_items (
  id uuid primary key default gen_random_uuid(),
  resume_id uuid unique references public.resumes(id) on delete set null,
  user_id uuid not null,
  file_path text not null unique,
  status text not null default 'pending'
    check (status in ('pending', 'parsed', 'low_coverage', 'failed', 'skipped')),
  coverage numeric,
  attempts int not null default 0,
  error text,
  notified_at timestamptz,
  file_deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists resume_migration_items_status_idx
  on public.resume_migration_items (status);

alter table public.resume_migration_items enable row level security;

revoke all on public.resume_migration_items from anon, authenticated;
grant all on public.resume_migration_items to service_role;
