-- Candidate pool, phases 2 and 3: company candidates get embeddings and one
-- search column, and are matched to the company's jobs.
-- Spec: plan/candidate-pool/feature-candidate-pool-spec.md (CP-REQ-040..043, CP-REQ-050/062, CP-REQ-070).
--
-- 1. company_candidates: embedding vector(768), embedding_updated_at,
--    embedding_stale (default true), search_text; HNSW and trigram indexes.
-- 2. candidate_embedding_queue: { "candidate_id": "<uuid>" }, service role only.
-- 3. Triggers:
--    - protect_company_candidate_columns: requests from users can't write the
--      embedding columns (the table has no user write grants; this keeps it
--      that way if one is ever added). search_text is always derived;
--    - company_candidate_derived_columns: keeps search_text, and marks the row
--      stale when an embedded column changes;
--    - company_candidate_enqueue_embedding: one queue message on insert and on
--      a change to an embedded column. Keep the column list in sync with
--      EMBEDDED_CANDIDATE_COLUMNS (helpers/candidates/embedding-text.ts).
-- 4. Backfill: search_text for every row, one message per existing candidate.
-- 5. The worker's cron job, every minute, created INACTIVE until the route is
--    deployed. Turn it on with
--      select cron.alter_job(job_id := (select jobid from cron.job where jobname = 'candidate-embeddings-worker'), active := true);
-- 6. match_company_candidates(job) and match_jobs_for_company_candidate(candidate).

create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------------
-- 1. Columns and indexes
-- ---------------------------------------------------------------------------

alter table public.company_candidates
  add column if not exists embedding public.vector(768),
  add column if not exists embedding_updated_at timestamptz,
  add column if not exists embedding_stale boolean not null default true,
  add column if not exists search_text text not null default '';

create index if not exists company_candidates_embedding_idx
  on public.company_candidates using hnsw (embedding public.vector_cosine_ops);
create index if not exists company_candidates_search_text_idx
  on public.company_candidates using gin (search_text extensions.gin_trgm_ops);

-- What the Candidates table's search box matches (CP-REQ-070): name, email,
-- title, company and skills, lower-cased.
create or replace function public.company_candidate_search_text(
  p_full_name text, p_email text, p_title text, p_company text, p_skills text[]
)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select lower(concat_ws(' ', p_full_name, p_email, p_title, p_company, array_to_string(p_skills, ' ')))
$$;

-- ---------------------------------------------------------------------------
-- 2. Queue
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pgmq.list_queues() where queue_name = 'candidate_embedding_queue') then
    perform pgmq.create('candidate_embedding_queue');
  end if;
end $$;

revoke all on pgmq.q_candidate_embedding_queue, pgmq.a_candidate_embedding_queue from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Triggers
-- ---------------------------------------------------------------------------

-- SECURITY INVOKER on purpose: current_role must be the caller's role. The
-- service role (the worker) and SECURITY DEFINER RPCs pass through.
create or replace function public.protect_company_candidate_columns()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_role in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.embedding := null;
      new.embedding_updated_at := null;
      new.embedding_stale := true;
    else
      new.embedding := old.embedding;
      new.embedding_updated_at := old.embedding_updated_at;
      new.embedding_stale := old.embedding_stale;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists company_candidates_protect_columns on public.company_candidates;
create trigger company_candidates_protect_columns
  before insert or update on public.company_candidates
  for each row execute function public.protect_company_candidate_columns();

-- Runs after the guard (triggers fire in name order).
create or replace function public.company_candidate_derived_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.search_text := public.company_candidate_search_text(
    new.full_name, new.email, new.current_title, new.current_company, new.skills);
  if tg_op = 'INSERT' then
    new.embedding_stale := true;
  elsif (new.current_title, new.current_company, new.experience_years, new.location, new.skills, new.resume_content)
        is distinct from
        (old.current_title, old.current_company, old.experience_years, old.location, old.skills, old.resume_content) then
    new.embedding_stale := true;
  end if;
  return new;
end $$;

drop trigger if exists company_candidates_set_derived on public.company_candidates;
create trigger company_candidates_set_derived
  before insert or update on public.company_candidates
  for each row execute function public.company_candidate_derived_columns();

create or replace function public.company_candidate_enqueue_embedding()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  perform pgmq.send('candidate_embedding_queue', jsonb_build_object('candidate_id', new.id));
  return null;
end $$;

revoke all on function public.company_candidate_enqueue_embedding() from public, anon, authenticated;

drop trigger if exists company_candidates_enqueue_embedding_insert on public.company_candidates;
create trigger company_candidates_enqueue_embedding_insert
  after insert on public.company_candidates
  for each row execute function public.company_candidate_enqueue_embedding();

drop trigger if exists company_candidates_enqueue_embedding_update on public.company_candidates;
create trigger company_candidates_enqueue_embedding_update
  after update of current_title, current_company, experience_years, location, skills, resume_content
  on public.company_candidates
  for each row
  when ((new.current_title, new.current_company, new.experience_years, new.location, new.skills, new.resume_content)
        is distinct from
        (old.current_title, old.current_company, old.experience_years, old.location, old.skills, old.resume_content))
  execute function public.company_candidate_enqueue_embedding();

-- ---------------------------------------------------------------------------
-- 4. Backfill (CP-REQ-043)
-- ---------------------------------------------------------------------------

-- Touches only search_text, so the update trigger doesn't enqueue.
update public.company_candidates c
   set search_text = public.company_candidate_search_text(
         c.full_name, c.email, c.current_title, c.current_company, c.skills);

select pgmq.send_batch('candidate_embedding_queue', array_agg(jsonb_build_object('candidate_id', c.id)))
  from public.company_candidates c
having count(*) > 0;

-- ---------------------------------------------------------------------------
-- 5. Cron job, inactive
-- ---------------------------------------------------------------------------

create or replace function pg_temp.schedule_inactive(p_name text, p_schedule text, p_path text)
returns void language plpgsql as $$
declare
  existing_job_id bigint;
  new_job_id bigint;
begin
  select jobid into existing_job_id from cron.job where jobname = p_name;
  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  new_job_id := cron.schedule(
    p_name,
    p_schedule,
    format(
      $cmd$
        select net.http_get(
          url := %L,
          headers := jsonb_build_object(
            'X-Internal-Secret',
            (select decrypted_secret from vault.decrypted_secrets where name = 'internal_secret')
          ),
          timeout_milliseconds := 300000
        );
      $cmd$,
      'https://gethired.devhub.co.in' || p_path
    )
  );

  perform cron.alter_job(job_id := new_job_id, active := false);
end $$;

do $$
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'internal_secret') then
    raise exception 'Internal secret not found in vault.';
  end if;

  perform pg_temp.schedule_inactive('candidate-embeddings-worker', '* * * * *', '/api/worker/candidate-embeddings');
end $$;

-- ---------------------------------------------------------------------------
-- 6. Matching (CP-REQ-050/062), phase 3
-- ---------------------------------------------------------------------------
-- Live, nothing stored (CP-DEC-003). Both return
--   { ok: true, job_embedded | candidate_embedded, matches: [{ company_candidate_id | job_post_id, similarity }] }
-- highest first, or { ok: false, reason } ('not_found', 'forbidden').
-- match_company_candidates also returns pool_size, the company's embedded
-- candidates, so the job page can hide its card when there are none, and each
-- match's has_email and has_resume (a parsed resume), so readers don't load
-- contact details for a badge. Never
-- the embedding. The company's rows are taken first and compared exactly, so
-- a small pool isn't cut short by the HNSW index's candidate list. The
-- default threshold is POOL_MATCH_MIN_SIMILARITY (helpers/matching/config.ts);
-- a test checks they agree.

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
       and c.claimed_user_id is null
       and not exists (
         select 1 from public.applications a
          where a.company_candidate_id = c.id and a.job_post_id = p_job_id
            and a.merged_into_application_id is null)
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
          where a.company_candidate_id = p_candidate_id and a.job_post_id = j.id
            and a.merged_into_application_id is null)
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
