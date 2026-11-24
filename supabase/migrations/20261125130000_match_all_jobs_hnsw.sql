-- match_all_jobs_test: let the HNSW index answer the query.
--
-- The old version ordered by (distance, id DESC). The HNSW index can only
-- return rows by distance alone, so Postgres read every job from the last 60
-- days (~15k rows, ~3 KB of TOASTed vector each, ~95k pages), sorted them and
-- kept the top 100: ~22 s per call, and it pushed the job feed's pages out of
-- memory.
--
-- Now:
-- - The inner scan orders by distance only, so it uses the index.
-- - hnsw.ef_search = 200 so a LIMIT of 100 can return up to 100 rows (the
--   default of 40 capped it at 40).
-- - On pgvector >= 0.8, hnsw.iterative_scan = relaxed_order keeps scanning
--   when the filters drop rows. Relaxed order can return rows slightly out of
--   order, so the outer query sorts again by (distance, id). Callers rely on
--   that order: rerankJobsIfApplicable restores it and sends the first 50 to
--   the re-ranker.
-- - The distance threshold applies after the LIMIT, so an iterative scan
--   doesn't keep reading the index looking for close matches that don't exist.
--   The result is the same set: the nearest match_count rows under the
--   threshold.
-- - Only active jobs, as the caller's query keeps only those anyway.
-- - Returns only id and distance_score: the caller reads only id.
--
-- The return type changes, so the function is dropped and recreated.

DROP FUNCTION IF EXISTS public.match_all_jobs_test(
  public.vector, double precision, integer, timestamp without time zone
);

CREATE FUNCTION public.match_all_jobs_test(
  embedding public.vector,
  match_threshold double precision,
  match_count integer,
  min_created_at timestamp without time zone
)
RETURNS TABLE (id uuid, distance_score double precision)
LANGUAGE plpgsql
STABLE
SET hnsw.ef_search = 200
AS $fn$
BEGIN
  -- Dynamic SQL, as before, so each call is planned with its real values.
  -- $1 = embedding, $2 = match_threshold, $3 = match_count, $4 = min_created_at
  RETURN QUERY EXECUTE $q$
    WITH nearest AS MATERIALIZED (
      SELECT
        all_jobs.id,
        (all_jobs.embedding_new <=> $1)::double precision AS distance_score
      FROM all_jobs
      WHERE all_jobs.status = 'active'
        AND all_jobs.created_at >= $4
      ORDER BY all_jobs.embedding_new <=> $1
      LIMIT $3
    )
    SELECT nearest.id, nearest.distance_score
    FROM nearest
    WHERE nearest.distance_score < $2
    ORDER BY nearest.distance_score, nearest.id
  $q$
  USING embedding, match_threshold, match_count, min_created_at;
END;
$fn$;

-- hnsw.iterative_scan exists from pgvector 0.8; setting it on an older
-- version is an error, so add it only when it's there.
DO $$
DECLARE
  v text;
BEGIN
  SELECT extversion INTO v FROM pg_extension WHERE extname = 'vector';
  IF string_to_array(split_part(v, '-', 1), '.')::int[] >= ARRAY[0, 8] THEN
    ALTER FUNCTION public.match_all_jobs_test(
      public.vector, double precision, integer, timestamp without time zone
    ) SET hnsw.iterative_scan = relaxed_order;
  END IF;
END;
$$;

ALTER FUNCTION public.match_all_jobs_test(
  public.vector, double precision, integer, timestamp without time zone
) OWNER TO postgres;

GRANT ALL ON FUNCTION public.match_all_jobs_test(
  public.vector, double precision, integer, timestamp without time zone
) TO anon, authenticated, service_role;
