-- Application forms, knockouts and question sets
-- (plan/careers-page/feature-careers-page-spec.md AF-*, plan/careers-page/feature-careers-page-tasks.md CPT-010/011).
--
-- Applicant-side compatibility (AF-CON-001): job_postings.questions and
-- applications.answers stay as they are. Everything here is additive.
--
-- Difference from the spec's sketch: job_postings is world-readable (the
-- public job board), so the knockout rules can't live inside
-- application_form. The public form is in job_postings.application_form and
-- the rules, keyed by question id, in job_posting_form_rules, which only the
-- job's company can read (AF-SEC-003).

-- ---------------------------------------------------------------------------
-- 1. Permissions (roles spec): careers.edit, question_sets.manage
-- ---------------------------------------------------------------------------

insert into public.company_permissions (key, scopable, requires) values
  ('careers.edit', false, '{}'),
  ('question_sets.manage', false, '{jobs.view}')
on conflict (key) do update set scopable = excluded.scopable, requires = excluded.requires;

-- The Admin template has every permission but company.profile (RP-REQ-004).
insert into public.company_role_permissions (role_id, permission_key, scope)
select r.id, k.key, 'all'
  from public.company_roles r
  cross join (values ('careers.edit'), ('question_sets.manage')) as k(key)
 where r.template_key = 'admin'
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 2. Job postings: the form, department and workplace type
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'workplace_type' and typnamespace = 'public'::regnamespace) then
    create type public.workplace_type as enum ('onsite', 'hybrid', 'remote');
  end if;
end $$;

alter table public.job_postings
  add column if not exists department text check (char_length(department) <= 60),
  add column if not exists workplace_type public.workplace_type,
  add column if not exists application_form jsonb not null
    default '{"version":1,"questions":[],"standard_fields":{}}'::jsonb;

-- The i-th legacy question gets the id helpers/jobs/application-form-schema.ts
-- (legacyQuestionId) gives it, so old answers line up with the new form.
create or replace function public.legacy_question_id(p_index int)
returns uuid
language sql immutable
set search_path = ''
as $$
  select ('00000000-0000-4000-8000-' || lpad((p_index + 1)::text, 12, '0'))::uuid
$$;

update public.job_postings jp
   set application_form = jsonb_build_object(
         'version', 1,
         'questions', coalesce((
           select jsonb_agg(jsonb_build_object(
                    'id', public.legacy_question_id((q.ord - 1)::int),
                    'type', 'long_text',
                    'label', left(btrim(q.label), 300),
                    'required', true
                  ) order by q.ord)
             from unnest(jp.questions) with ordinality as q(label, ord)
            where btrim(q.label) <> ''
         ), '[]'::jsonb),
         'standard_fields', '{}'::jsonb
       )
 where coalesce(jsonb_array_length(jp.application_form -> 'questions'), 0) = 0
   and coalesce(array_length(jp.questions, 1), 0) > 0;

-- Knockout rules per job: {"questions": {"<question id>": rule}, "standard": {"work_authorization": rule}}.
create table if not exists public.job_posting_form_rules (
  job_post_id uuid primary key references public.job_postings(id) on delete cascade,
  company_id uuid not null references public.company_info(id) on delete cascade,
  rules jsonb not null default '{"questions":{},"standard":{}}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.job_posting_form_rules enable row level security;

drop policy if exists "job_posting_form_rules_select_company" on public.job_posting_form_rules;
create policy "job_posting_form_rules_select_company"
  on public.job_posting_form_rules for select to authenticated
  using (job_post_id = any ((select public.my_job_ids_with('jobs.view'))::uuid[]));

-- Written only by the server (upsertJobPosting, service role).
revoke all on public.job_posting_form_rules from public, anon, authenticated;
grant select on public.job_posting_form_rules to authenticated;
grant all on public.job_posting_form_rules to service_role;

-- ---------------------------------------------------------------------------
-- 3. Applications: typed answers, the form snapshot and the source detail
-- ---------------------------------------------------------------------------

alter table public.applications
  add column if not exists answers_v2 jsonb,
  add column if not exists form_snapshot jsonb,
  add column if not exists source_detail text check (char_length(source_detail) <= 40);

create index if not exists applications_answers_v2_gin
  on public.applications using gin (answers_v2 jsonb_path_ops);

-- CP-REQ-013: applications started on a careers page.
alter table public.applications drop constraint if exists applications_source_check;
alter table public.applications add constraint applications_source_check
  check (source in ('applied', 'outreach', 'imported', 'agent', 'careers_page'));

-- ---------------------------------------------------------------------------
-- 4. Knockout results: company-only (AF-SEC-003)
-- ---------------------------------------------------------------------------

create table if not exists public.application_knockouts (
  application_id uuid primary key references public.applications(id) on delete cascade,
  company_id uuid not null references public.company_info(id) on delete cascade,
  job_post_id uuid not null references public.job_postings(id) on delete cascade,
  failed boolean not null,
  reasons jsonb not null default '[]'::jsonb,
  action_taken text not null check (action_taken in ('none', 'flagged', 'rejected')),
  -- AF-DEC-002: a rejection email goes out after a delay, sent by the knockouts worker.
  reject_email_due_at timestamptz,
  reject_email_sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists application_knockouts_due
  on public.application_knockouts (reject_email_due_at)
  where reject_email_due_at is not null and reject_email_sent_at is null;

alter table public.application_knockouts enable row level security;

drop policy if exists "application_knockouts_select_company" on public.application_knockouts;
create policy "application_knockouts_select_company"
  on public.application_knockouts for select to authenticated
  using (job_post_id = any ((select public.my_job_ids_with('applicants.view'))::uuid[]));

revoke all on public.application_knockouts from public, anon, authenticated;
grant select on public.application_knockouts to authenticated;
grant all on public.application_knockouts to service_role;

-- ---------------------------------------------------------------------------
-- 5. Question sets (AF-REQ-004)
-- ---------------------------------------------------------------------------

create table if not exists public.company_question_sets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.company_info(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  form jsonb not null,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists company_question_sets_name
  on public.company_question_sets (company_id, lower(btrim(name)));

alter table public.company_question_sets enable row level security;

drop policy if exists "company_question_sets_select_member" on public.company_question_sets;
create policy "company_question_sets_select_member"
  on public.company_question_sets for select to authenticated
  using (public.is_company_member(company_id));

drop policy if exists "company_question_sets_insert" on public.company_question_sets;
create policy "company_question_sets_insert"
  on public.company_question_sets for insert to authenticated
  with check (company_id = public.my_company_id()
              and public.has_company_permission(company_id, 'question_sets.manage'));

drop policy if exists "company_question_sets_update" on public.company_question_sets;
create policy "company_question_sets_update"
  on public.company_question_sets for update to authenticated
  using (public.has_company_permission(company_id, 'question_sets.manage'))
  with check (company_id = public.my_company_id()
              and public.has_company_permission(company_id, 'question_sets.manage'));

drop policy if exists "company_question_sets_delete" on public.company_question_sets;
create policy "company_question_sets_delete"
  on public.company_question_sets for delete to authenticated
  using (public.has_company_permission(company_id, 'question_sets.manage'));

-- AF-REQ-004: at most 25 sets per company.
create or replace function public.check_question_set_cap()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.company_question_sets where company_id = new.company_id) >= 25 then
    raise exception using errcode = 'P0001', message = 'QUESTION_SET_LIMIT';
  end if;
  return new;
end $$;

drop trigger if exists company_question_sets_cap on public.company_question_sets;
create trigger company_question_sets_cap
  before insert on public.company_question_sets
  for each row execute function public.check_question_set_cap();

revoke all on public.company_question_sets from public, anon, authenticated;
grant select, insert, update, delete on public.company_question_sets to authenticated;
grant all on public.company_question_sets to service_role;
revoke all on function public.check_question_set_cap() from public, anon;
