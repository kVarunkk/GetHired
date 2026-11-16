-- Index the job title keyword search.
--
-- The jobs list filters titles with case-insensitive regexes on
-- all_jobs.job_name_search (titleKeywordConditions in
-- helpers/jobs/filterQueryBuilder.ts), and nothing indexed that column, so a
-- keyword search reads every job. A trigram GIN index serves `~*`.
-- About 2-5 MB at 15k jobs.
--
-- Plain CREATE INDEX (migrations run in a transaction), so it blocks writes
-- to all_jobs while it builds; at this size that's a few seconds. To avoid
-- even that, run this first outside a transaction, and this is a no-op:
--   create index concurrently if not exists idx_all_jobs_job_name_search_trgm
--     on public.all_jobs using gin (job_name_search extensions.gin_trgm_ops);

create extension if not exists pg_trgm with schema extensions;

create index if not exists idx_all_jobs_job_name_search_trgm
  on public.all_jobs using gin (job_name_search extensions.gin_trgm_ops);
