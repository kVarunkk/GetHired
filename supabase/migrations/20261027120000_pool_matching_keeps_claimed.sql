-- Bulk candidate import, phase 6: claimed candidates stay in pool matching
-- (plan/bulk-import/feature-bulk-import-tasks.md BIT-104).
--
-- A claim connects a GetHired account to the company's record; it doesn't
-- take the person out of the company's pool. Someone already in the job is
-- still left out, and for a claimed candidate that includes the account's own
-- application to the job (which has no company_candidate_id).
--
-- 1. match_company_candidates: no claimed exclusion
-- 2. match_jobs_for_company_candidate: the account's applications count
-- 3. create_imported_application: the account's applications count, so "Add
--    to job" from a match doesn't add a second application

-- ---------------------------------------------------------------------------
-- 1. match_company_candidates
-- ---------------------------------------------------------------------------

-- As in 20261026130000_candidate_pool_matching.sql, except that claimed
-- candidates match too.
create or replace function public.match_company_candidates(
  p_job_id uuid, p_limit int default 50, p_min_similarity real default 0.55
)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_company uuid := public.my_company_id();
  v_job public.job_postings%rowtype;
  v_matches jsonb;
  v_pool int;
begin
  select * into v_job from public.job_postings j where j.id = p_job_id;
  if v_company is null or v_job.id is null or v_job.company_id is distinct from v_company then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if not public.has_company_permission(v_company, 'talent.view')
     or not public.has_company_permission(v_company, 'jobs.view', p_job_id) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  select count(*)::int into v_pool from public.company_candidates c
   where c.company_id = v_company and c.embedding is not null;
  if v_job.embedding_new is null then
    return jsonb_build_object('ok', true, 'job_embedded', false, 'pool_size', v_pool, 'matches', '[]'::jsonb);
  end if;

  with pool as materialized (
    select c.id, 1 - (c.embedding operator(public.<=>) v_job.embedding_new) as similarity,
           c.email is not null as has_email, c.resume_content is not null as has_resume
      from public.company_candidates c
     where c.company_id = v_company
       and c.embedding is not null
       and not exists (
         select 1 from public.applications a
          where a.job_post_id = p_job_id
            and a.merged_into_application_id is null
            and (a.company_candidate_id = c.id or a.applicant_user_id = c.claimed_user_id))
  )
  select coalesce(jsonb_agg(jsonb_build_object('company_candidate_id', m.id, 'similarity', round(m.similarity::numeric, 4),
                                               'has_email', m.has_email, 'has_resume', m.has_resume)
                            order by m.similarity desc, m.id), '[]'::jsonb)
    into v_matches
    from (select p.id, p.similarity, p.has_email, p.has_resume from pool p
           where p.similarity >= coalesce(p_min_similarity, 0)
           order by p.similarity desc, p.id
           limit least(greatest(coalesce(p_limit, 50), 1), 200)) m;

  return jsonb_build_object('ok', true, 'job_embedded', true, 'pool_size', v_pool, 'matches', v_matches);
end $$;

-- ---------------------------------------------------------------------------
-- 2. match_jobs_for_company_candidate
-- ---------------------------------------------------------------------------

-- As in 20261026130000_candidate_pool_matching.sql, except that a job the
-- claimed account applied to is left out too.
create or replace function public.match_jobs_for_company_candidate(
  p_candidate_id uuid, p_limit int default 10, p_min_similarity real default 0.55
)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_company uuid := public.my_company_id();
  v_candidate public.company_candidates%rowtype;
  v_matches jsonb;
begin
  select * into v_candidate from public.company_candidates c where c.id = p_candidate_id;
  if v_company is null or v_candidate.id is null or v_candidate.company_id is distinct from v_company then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if not public.has_company_permission(v_company, 'talent.view') then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if v_candidate.embedding is null then
    return jsonb_build_object('ok', true, 'candidate_embedded', false, 'matches', '[]'::jsonb);
  end if;

  with jobs as materialized (
    select j.id, 1 - (j.embedding_new operator(public.<=>) v_candidate.embedding) as similarity
      from public.job_postings j
     where j.company_id = v_company
       and j.status = 'active'
       and j.embedding_new is not null
       and public.has_company_permission(v_company, 'jobs.view', j.id)
       and not exists (
         select 1 from public.applications a
          where a.job_post_id = j.id
            and a.merged_into_application_id is null
            and (a.company_candidate_id = p_candidate_id or a.applicant_user_id = v_candidate.claimed_user_id))
  )
  select coalesce(jsonb_agg(jsonb_build_object('job_post_id', m.id, 'similarity', round(m.similarity::numeric, 4))
                            order by m.similarity desc, m.id), '[]'::jsonb)
    into v_matches
    from (select j.id, j.similarity from jobs j
           where j.similarity >= coalesce(p_min_similarity, 0)
           order by j.similarity desc, j.id
           limit least(greatest(coalesce(p_limit, 10), 1), 50)) m;

  return jsonb_build_object('ok', true, 'candidate_embedded', true, 'matches', v_matches);
end $$;

revoke all on function public.match_company_candidates(uuid, int, real) from public, anon, authenticated;
grant execute on function public.match_company_candidates(uuid, int, real) to authenticated, service_role;
revoke all on function public.match_jobs_for_company_candidate(uuid, int, real) from public, anon, authenticated;
grant execute on function public.match_jobs_for_company_candidate(uuid, int, real) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. create_imported_application
-- ---------------------------------------------------------------------------

-- As in 20261025120000_bulk_import.sql, except that a claimed candidate whose
-- account already applied to the job is already in it, whatever the
-- account's email.
create or replace function public.create_imported_application(
  p_candidate_id uuid, p_job_id uuid, p_stage_id uuid, p_batch_id uuid
)
returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  v_company uuid;
  v_all_jobs uuid;
  v_email text;
  v_claimed uuid;
  v_app uuid;
begin
  select jp.company_id, jp.job_id into v_company, v_all_jobs from public.job_postings jp where jp.id = p_job_id;
  select c.email, c.claimed_user_id into v_email, v_claimed from public.company_candidates c where c.id = p_candidate_id;
  if v_email is null then return 'no_email'; end if;

  if exists (select 1 from public.applications a
              where a.company_candidate_id = p_candidate_id and a.job_post_id = p_job_id) then
    return 'already_in_job';
  end if;
  -- BI-REQ-019: a GetHired user with this email who already applied to the job.
  if exists (select 1 from public.applications a join auth.users u on u.id = a.applicant_user_id
              where a.job_post_id = p_job_id and lower(u.email) = v_email) then
    return 'already_in_job';
  end if;
  -- BIT-104: the account that claimed this candidate already applied.
  if v_claimed is not null and exists (
    select 1 from public.applications a where a.job_post_id = p_job_id and a.applicant_user_id = v_claimed
  ) then
    return 'already_in_job';
  end if;

  insert into public.applications
    (applicant_user_id, job_post_id, all_jobs_id, source, stage_id, stage_entered_at,
     company_candidate_id, import_batch_id)
  values
    (null, p_job_id, v_all_jobs, 'imported', p_stage_id, now(), p_candidate_id, p_batch_id)
  returning id into v_app;

  insert into public.application_events
    (company_id, application_id, candidate_user_id, actor_user_id, actor_name, type, payload)
  values
    (v_company, v_app, null, (select auth.uid()), public.member_display_name((select auth.uid())), 'imported',
     jsonb_build_object('stage_id', p_stage_id, 'batch_id', p_batch_id, 'company_candidate_id', p_candidate_id));
  return 'added';
end $$;
revoke all on function public.create_imported_application(uuid, uuid, uuid, uuid) from public, anon, authenticated;
