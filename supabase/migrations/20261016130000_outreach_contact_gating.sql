-- Recruiter outreach, part 2 (OR-TASK-011, ORT-042): contact gating.
--
-- Talent-pool candidates (public, no application, no Interested answer) are
-- read through `candidate_directory`, which has no contact columns. Their
-- user_info row, resumes rows and resume files open to a company only once
-- they applied to it or answered Interested (OR-SEC-001).
--
-- 1. redact_pii, resume_sections_public (difference 3), and
--    resume_public_sections, which stores them per resume
-- 2. company_has_candidate_access (difference 7)
-- 3. candidate_directory
-- 4. Policy switch on user_info (difference 4), resumes and storage
--
-- Tests: supabase/tests/recruiter_outreach.sql, block 2, and
-- supabase/tests/recruiter_access.sql (talent-pool cases updated).

-- ---------------------------------------------------------------------------
-- 1. Scrubbed resume sections
-- ---------------------------------------------------------------------------

-- Same patterns as scrubPII in helpers/ai/fairness.ts (ARE: \y is a word
-- boundary). A run of 10 to 15 digits is a phone number; years and ranges stay.
create or replace function public.redact_pii(p_text text)
returns text
language plpgsql immutable
set search_path = ''
as $$
declare
  v text := p_text;
  m text;
begin
  if v is null then return null; end if;
  v := regexp_replace(v, '[\w.+-]+@[\w-]+(?:\.[\w-]+)+', '[removed]', 'g');
  v := regexp_replace(v, '\y(?:https?://|www\.)[^\s<>()"'']+[^\s<>()"''.,;:!?]', '[removed]', 'gi');
  v := regexp_replace(v,
    '\y[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:[a-z]{2,}/[^\s<>()"'']*[^\s<>()"''.,;:!?]|(?:com|in|io|dev|org|net|me|co|ai|app|xyz|tech)\y)',
    '[removed]', 'gi');
  for m in select (regexp_matches(v, '(\+?\(?\d[\d\s().-]{7,}\d)', 'g'))[1] loop
    if length(regexp_replace(m, '\D', '', 'g')) between 10 and 15 then
      v := replace(v, m, '[removed]');
    end if;
  end loop;
  return v;
end $$;

-- Parsed resumes are `{ sections: [{ type, items: [{ heading, subheading,
-- bullets: [{ text }] }] }] }` (helpers/resume/parse-resume.ts). Keeps the
-- experience, skills, projects and education sections, in order, with every
-- string redacted. Anything malformed becomes [].
create or replace function public.resume_sections_public(p_content jsonb)
returns jsonb
language sql immutable
set search_path = ''
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'type', s.sec->>'type',
      'items', coalesce((
        select jsonb_agg(
          jsonb_strip_nulls(jsonb_build_object(
            'heading', public.redact_pii(i.item->>'heading'),
            'subheading', public.redact_pii(i.item->>'subheading'),
            'bullets', coalesce((
              select jsonb_agg(jsonb_build_object('text', public.redact_pii(b.bullet->>'text')) order by b.ord)
              from jsonb_array_elements(
                case when jsonb_typeof(i.item->'bullets') = 'array' then i.item->'bullets' else '[]'::jsonb end
              ) with ordinality as b(bullet, ord)
              where jsonb_typeof(b.bullet) = 'object' and b.bullet->>'text' is not null
            ), '[]'::jsonb)
          ))
          order by i.ord)
        from jsonb_array_elements(
          case when jsonb_typeof(s.sec->'items') = 'array' then s.sec->'items' else '[]'::jsonb end
        ) with ordinality as i(item, ord)
        where jsonb_typeof(i.item) = 'object'
      ), '[]'::jsonb)
    )
    order by s.ord), '[]'::jsonb)
  from jsonb_array_elements(
    case when jsonb_typeof(p_content) = 'object' and jsonb_typeof(p_content->'sections') = 'array'
         then p_content->'sections' else '[]'::jsonb end
  ) with ordinality as s(sec, ord)
  where jsonb_typeof(s.sec) = 'object'
    and s.sec->>'type' in ('experience', 'skills', 'projects', 'education')
$$;

-- Redacting is ~1.5 ms a resume. The directory is a security_barrier view,
-- so the planner can't defer it past a LIMIT; computing it per query took
-- 1.7 s for a 20-row page. So it's stored per resume, by a trigger, in a side
-- table: the resumes table and what the applicant app reads from it don't
-- change. The trigger never fails a resume save.
create table if not exists public.resume_public_sections (
  resume_id uuid primary key references public.resumes(id) on delete cascade,
  sections jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.resume_public_sections enable row level security;
-- No policies: only the definer view reads it.
revoke all on public.resume_public_sections from anon, authenticated;

create or replace function public.store_resume_public_sections()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  begin
    v := public.resume_sections_public(new.content);
  exception when others then
    raise warning 'store_resume_public_sections(%): %', new.id, sqlerrm;
    v := '[]'::jsonb;
  end;
  begin
    insert into public.resume_public_sections (resume_id, sections, updated_at)
    values (new.id, v, now())
    on conflict (resume_id) do update set sections = excluded.sections, updated_at = excluded.updated_at;
  exception when others then
    raise warning 'store_resume_public_sections(%): %', new.id, sqlerrm;
  end;
  return null;
end $$;

revoke all on function public.store_resume_public_sections() from public, anon, authenticated;

drop trigger if exists resumes_store_public_sections on public.resumes;
create trigger resumes_store_public_sections
  after insert or update of content on public.resumes
  for each row execute function public.store_resume_public_sections();

insert into public.resume_public_sections (resume_id, sections)
select r.id, public.resume_sections_public(r.content) from public.resumes r
on conflict (resume_id) do update set sections = excluded.sections, updated_at = now();

create index if not exists resumes_user_primary_idx on public.resumes (user_id) where is_primary;

revoke all on function public.redact_pii(text) from public, anon;
revoke all on function public.resume_sections_public(jsonb) from public, anon;
grant execute on function public.redact_pii(text) to authenticated, service_role;
grant execute on function public.resume_sections_public(jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Contact access: applied, or answered Interested (OR-REQ-011)
-- ---------------------------------------------------------------------------

create or replace function public.company_has_candidate_access(p_user_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select public.my_company_id() is not null and (
    exists (
      select 1 from public.applications a
      join public.job_postings jp on jp.id = a.job_post_id
      where a.applicant_user_id = p_user_id and jp.company_id = public.my_company_id()
    )
    or exists (
      select 1 from public.candidate_outreach o
      where o.candidate_user_id = p_user_id and o.company_id = public.my_company_id()
        and o.status = 'interested'
    )
  )
$$;

revoke all on function public.company_has_candidate_access(uuid) from public, anon;
grant execute on function public.company_has_candidate_access(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. The directory (OR-REQ-010, OR-SEC-004)
-- ---------------------------------------------------------------------------

-- A definer view (owned by postgres, so it reads user_info past RLS) that
-- returns only directory columns of public candidates, to company users,
-- minus candidates who blocked the caller's company. security_barrier keeps
-- caller-supplied filters from running before these.
drop view if exists public.candidate_directory;
create view public.candidate_directory
with (security_barrier = true)
as
select
  u.user_id,
  u.full_name,
  u.desired_roles,
  u.preferred_locations,
  u.job_type,
  u.min_salary,
  u.max_salary,
  u.salary_currency,
  u.experience_years,
  u.industry_preferences,
  u.visa_sponsorship_required,
  u.top_skills,
  u.work_style_preferences,
  u.career_goals_short_term,
  u.career_goals_long_term,
  u.company_size_preference,
  u.filled,
  u.is_public,
  u.accepts_outreach,
  u.created_at,
  u.updated_at,
  coalesce((
    select ps.sections
    from public.resumes r
    join public.resume_public_sections ps on ps.resume_id = r.id
    where r.user_id = u.user_id and r.is_primary
    order by r.created_at desc
    limit 1
  ), '[]'::jsonb) as resume_sections
from public.user_info u
where u.is_public
  and (select public.my_company_id()) is not null
  and not exists (
    select 1 from public.candidate_company_blocks b
    where b.candidate_user_id = u.user_id and b.company_id = (select public.my_company_id())
  );

alter view public.candidate_directory owner to postgres;
revoke all on public.candidate_directory from public, anon, authenticated;
grant select on public.candidate_directory to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Policy switch
-- ---------------------------------------------------------------------------

-- user_info: talent-pool rows are no longer readable by companies. Interested
-- candidates are, in the same cheap form as the applicants policy (one company
-- lookup per query, not a function call per row; RS-RISK-002).
drop policy if exists "Companies can view public candidates" on public.user_info;
drop policy if exists "Companies can view interested candidates" on public.user_info;
create policy "Companies can view interested candidates"
  on public.user_info for select to authenticated
  using (
    exists (
      select 1 from public.candidate_outreach o
      where o.candidate_user_id = user_info.user_id
        and o.company_id = (select public.my_company_id())
        and o.status = 'interested'
    )
  );

-- resumes rows and files: applied or interested.
drop policy if exists "Companies can view visible candidates' resumes" on public.resumes;
drop policy if exists "Companies can view accessible candidates' resumes" on public.resumes;
create policy "Companies can view accessible candidates' resumes"
  on public.resumes for select to authenticated
  using (public.company_has_candidate_access(user_id));

drop policy if exists "Companies can view visible candidates' resume files" on storage.objects;
drop policy if exists "Companies can view accessible candidates' resume files" on storage.objects;
create policy "Companies can view accessible candidates' resume files"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'resumes'
    and case
      when (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then public.company_has_candidate_access(((storage.foldername(name))[2])::uuid)
      else false
    end
  );
