

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "public";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgjwt" WITH SCHEMA "public";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "vector" WITH SCHEMA "public";






CREATE TYPE "public"."application_status" AS ENUM (
    'submitted',
    'reviewed',
    'selected',
    'stand_by',
    'rejected'
);


ALTER TYPE "public"."application_status" OWNER TO "postgres";


CREATE TYPE "public"."job_feedback_vote" AS ENUM (
    'upvote',
    'downvote'
);


ALTER TYPE "public"."job_feedback_vote" OWNER TO "postgres";


CREATE TYPE "public"."job_posting_status" AS ENUM (
    'active',
    'inactive'
);


ALTER TYPE "public"."job_posting_status" OWNER TO "postgres";


CREATE TYPE "public"."job_type_enum" AS ENUM (
    'Fulltime',
    'Intern',
    'Contract'
);


ALTER TYPE "public"."job_type_enum" OWNER TO "postgres";


CREATE TYPE "public"."payment_status" AS ENUM (
    'complete',
    'failed',
    'pending',
    'cancelled'
);


ALTER TYPE "public"."payment_status" OWNER TO "postgres";


CREATE TYPE "public"."visa_job_postings" AS ENUM (
    'Will Sponsor',
    'Not Required',
    'Required'
);


ALTER TYPE "public"."visa_job_postings" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."deduct_user_credits"("p_user_id" "uuid", "p_amount" integer) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  -- 1. Perform the update only if the user has enough credits
  UPDATE user_info
  SET 
    ai_credits = ai_credits - p_amount,
    updated_at = NOW()
  WHERE user_id = p_user_id
    AND ai_credits >= p_amount;

  -- 2. Check if any row was actually updated
  -- If not, it means the user didn't have enough credits or the ID was wrong
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Insufficient credits or user not found';
  END IF;
END;
$$;


ALTER FUNCTION "public"."deduct_user_credits"("p_user_id" "uuid", "p_amount" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_applicant_weekly_metrics"("p_user_id" "uuid") RETURNS TABLE("user_id" "uuid", "applications_submitted_weekly" integer, "status_updates_weekly" integer, "jobs_favorited_weekly" integer, "resumes_created_weekly" integer, "resume_reviews_created_weekly" integer)
    LANGUAGE "sql"
    AS $$
SELECT
    p_user_id AS user_id,
    
    -- 1. Applications Submitted (Past 7 Days)
    (
        SELECT COUNT(*)::integer
        FROM public.applications app
        WHERE app.applicant_user_id = p_user_id
          AND app.created_at >= NOW() - INTERVAL '7 days'
    ) AS applications_submitted_weekly,
    
    -- 2. New Status Updates (Applications updated in the past 7 Days)
    (
        SELECT COUNT(DISTINCT app_updated.id)::integer
        FROM public.applications app_updated
        WHERE app_updated.applicant_user_id = p_user_id
          AND app_updated.updated_at >= NOW() - INTERVAL '7 days'
          -- Ensure we only count meaningful updates, not just the creation time
          AND app_updated.updated_at != app_updated.created_at
    ) AS status_updates_weekly,
    
    -- 3. Jobs Favorited (Past 7 Days)
    (
        SELECT COUNT(*)::integer
        FROM public.user_favorites fav
        WHERE fav.user_id = p_user_id
          AND fav.created_at >= NOW() - INTERVAL '7 days'
    ) AS jobs_favorited_weekly,

    -- 4. Resumes Created (Past 7 Days)
    (
        SELECT COUNT(*)::integer
        FROM public.resumes r
        WHERE r.user_id = p_user_id
          AND r.created_at >= NOW() - INTERVAL '7 days'
    ) AS resumes_created_weekly,

    -- 5. AI Resume Reviews Created (Past 7 Days)
    (
        SELECT COUNT(*)::integer
        FROM public.resume_reviews rr
        WHERE rr.user_id = p_user_id
          AND rr.created_at >= NOW() - INTERVAL '7 days'
    ) AS resume_reviews_created_weekly
$$;


ALTER FUNCTION "public"."get_applicant_weekly_metrics"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_company_metrics"("company_id" "uuid") RETURNS TABLE("total_jobs" bigint, "total_applicants" bigint, "new_applicants_today" bigint)
    LANGUAGE "plpgsql"
    AS $$
begin
  return query
    select
      -- Count all job posts for the company, as 'status' is not a column in job_postings.
      (select count(*) from public.job_postings where job_postings.company_id = get_company_metrics.company_id) as total_jobs,
      
      -- Count all applications for jobs belonging to the company.
      (select count(*) from public.applications where applications.job_post_id in (select id from public.job_postings where job_postings.company_id = get_company_metrics.company_id)) as total_applicants,
      
      -- Count all new applications submitted in the last 24 hours.
      (select count(*) from public.applications where applications.job_post_id in (select id from public.job_postings where job_postings.company_id = get_company_metrics.company_id) and applications.created_at >= now() - interval '24 hours') as new_applicants_today;
end;
$$;


ALTER FUNCTION "public"."get_company_metrics"("company_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_unique_companies"() RETURNS TABLE("company_name" "text")
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RETURN QUERY
    SELECT DISTINCT aj.company_name
    FROM all_jobs AS aj
    -- Exclude jobs where company_name is null or empty
    WHERE aj.company_name IS NOT NULL AND aj.company_name <> ''
    ORDER BY aj.company_name;
END;
$$;


ALTER FUNCTION "public"."get_unique_companies"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_unique_companies_company_info"() RETURNS TABLE("company_name" "text")
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RETURN QUERY
    SELECT DISTINCT aj.name
    FROM company_info AS aj
    -- Exclude jobs where company_name is null or empty
    WHERE aj.name IS NOT NULL AND aj.name <> ''
    ORDER BY aj.name;
END;
$$;


ALTER FUNCTION "public"."get_unique_companies_company_info"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_unique_locations"() RETURNS TABLE("location" "text")
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RETURN QUERY
    SELECT DISTINCT unnest(aj.locations) AS location
    FROM all_jobs AS aj
    -- Exclude jobs where locations array is null or empty
    WHERE aj.locations IS NOT NULL AND array_length(aj.locations, 1) > 0
    ORDER BY location;
END;
$$;


ALTER FUNCTION "public"."get_unique_locations"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_unique_locations_company_info"() RETURNS TABLE("location" "text")
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RETURN QUERY
    SELECT DISTINCT aj.headquarters
    FROM company_info AS aj
    -- Exclude jobs where company_name is null or empty
    WHERE aj.headquarters IS NOT NULL AND aj.headquarters <> ''
    ORDER BY aj.headquarters;
END;
$$;


ALTER FUNCTION "public"."get_unique_locations_company_info"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_unique_profile_filters"() RETURNS "jsonb"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
    result jsonb;
BEGIN
    -- This query builds a single JSON object with all the unique arrays.
    SELECT jsonb_build_object(
        'uniqueJobRoles', (
            SELECT jsonb_agg(jsonb_build_object('job_role', roles))
            FROM (
                -- Use a subquery to unnest the array and then apply DISTINCT
                -- to get only unique values.
                SELECT DISTINCT unnest(desired_roles) AS roles
                FROM user_info
                -- Filter out any null or empty strings
                WHERE desired_roles IS NOT NULL AND array_length(desired_roles, 1) > 0
            ) AS roles_list
        ),
        'uniqueLocations', (
            SELECT jsonb_agg(jsonb_build_object('location', loc))
            FROM (
                SELECT DISTINCT unnest(preferred_locations) AS loc
                FROM user_info
                WHERE preferred_locations IS NOT NULL AND array_length(preferred_locations, 1) > 0
            ) AS locations_list
        ),
        'uniqueSkills', (
            SELECT jsonb_agg(jsonb_build_object('skill', skill))
            FROM (
                SELECT DISTINCT unnest(top_skills) AS skill
                FROM user_info
                WHERE top_skills IS NOT NULL AND array_length(top_skills, 1) > 0
            ) AS skills_list
        ),
        'uniqueIndustryPreferences', (
            SELECT jsonb_agg(jsonb_build_object('industry_preference', industry))
            FROM (
                SELECT DISTINCT unnest(industry_preferences) AS industry
                FROM user_info
                WHERE industry_preferences IS NOT NULL AND array_length(industry_preferences, 1) > 0
            ) AS industry_list
        ),
        'uniqueWorkStylePreferences', (
            SELECT jsonb_agg(jsonb_build_object('work_style_preference', work_style))
            FROM (
                SELECT DISTINCT unnest(work_style_preferences) AS work_style
                FROM user_info
                WHERE work_style_preferences IS NOT NULL AND array_length(work_style_preferences, 1) > 0
            ) AS work_styles_list
        )
    ) INTO result;

    RETURN result;
END;
$$;


ALTER FUNCTION "public"."get_unique_profile_filters"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_job_embedding"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$DECLARE
    fastapi_url TEXT := 'https://gethired.devhub.co.in/api/update-embedding/gemini/job';
    service_role_key TEXT;
    internal_secret TEXT;
    payload JSONB;
    response JSONB;
BEGIN
    -- Fetch service role key from secrets
    SELECT decrypted_secret INTO service_role_key
    FROM vault.decrypted_secrets
    WHERE name = 'service_role_key';

    IF service_role_key IS NULL THEN
        RAISE EXCEPTION 'Service role key not found in vault.';
    END IF;

     -- Fetch internal secret from secrets
    SELECT decrypted_secret INTO internal_secret
    FROM vault.decrypted_secrets
    WHERE name = 'internal_secret';

    IF internal_secret IS NULL THEN
        RAISE EXCEPTION 'Internal secret not found in vault.';
    END IF;

    -- Build the payload to send to FastAPI
    payload := jsonb_build_object(
        'id', NEW.id,
        'job_name', NEW.job_name,
        'description', NEW.description,
        'locations', NEW.locations,
        'job_type', NEW.job_type,
        'experience', NEW.experience,
        'salary_range', NEW.salary_range,
        'table', 'all_jobs'
    );

    RAISE NOTICE 'Sending POST request to % with payload: %', fastapi_url, payload;

    -- Perform HTTP POST and capture response
    response := net.http_post(
        url:= fastapi_url,
        body:= payload,
        headers:= jsonb_build_object(
            'X-Internal-Secret', internal_secret,
            'Content-Type', 'application/json'
        ),
        timeout_milliseconds:= 10000
    );

    RAISE NOTICE 'Response from FastAPI: %', response;

    RETURN NEW;

EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Caught exception in handle_job_embedding: %', SQLERRM;
    RAISE;
END;$$;


ALTER FUNCTION "public"."handle_job_embedding"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_job_posting_embedding"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$DECLARE
    fastapi_url TEXT := 'https://gethired.devhub.co.in/api/update-embedding/gemini/job';
    service_role_key TEXT;
    internal_secret TEXT;
    payload JSONB;
    response JSONB;
BEGIN
    -- Fetch service role key from secrets
    SELECT decrypted_secret INTO service_role_key
    FROM vault.decrypted_secrets
    WHERE name = 'service_role_key';

    IF service_role_key IS NULL THEN
        RAISE EXCEPTION 'Service role key not found in vault.';
    END IF;

     -- Fetch internal secret from secrets
    SELECT decrypted_secret INTO internal_secret
    FROM vault.decrypted_secrets
    WHERE name = 'internal_secret';

    IF internal_secret IS NULL THEN
        RAISE EXCEPTION 'Internal secret not found in vault.';
    END IF;

    -- Build the payload to send to FastAPI
    payload := jsonb_build_object(
        'id', NEW.id,
        'job_name', NEW.title,
        'description', NEW.description,
        'locations', NEW.location,
        'job_type', NEW.job_type,
        'experience', NEW.experience,
        'salary_range', NEW.salary_range,
        'table', 'job_postings'
    );

    RAISE NOTICE 'Sending POST request to % with payload: %', fastapi_url, payload;

    -- Perform HTTP POST and capture response
    response := net.http_post(
        url:= fastapi_url,
        body:= payload,
        headers:= jsonb_build_object(
            'X-Internal-Secret', internal_secret,
            'Content-Type', 'application/json'
        ),
        timeout_milliseconds:= 10000
    );

    RAISE NOTICE 'Response from FastAPI: %', response;

    RETURN NEW;

EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Caught exception in handle_job_posting_embedding: %', SQLERRM;
    RAISE;
END;$$;


ALTER FUNCTION "public"."handle_job_posting_embedding"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."match_all_companies"("query_embedding" "public"."vector", "match_threshold" double precision, "match_count" integer) RETURNS TABLE("id" "uuid")
    LANGUAGE "sql" STABLE
    AS $$
    SELECT id
    FROM company_info
    WHERE 
        embedding_new IS NOT NULL
        -- Use the unique name 'query_embedding' to ensure we use the input argument
        AND (embedding_new <=> query_embedding) < match_threshold
    ORDER BY embedding_new <=> query_embedding
    LIMIT match_count;
$$;


ALTER FUNCTION "public"."match_all_companies"("query_embedding" "public"."vector", "match_threshold" double precision, "match_count" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."match_all_jobs_test"("embedding" "public"."vector", "match_threshold" double precision, "match_count" integer, "min_created_at" timestamp without time zone) RETURNS TABLE("id" "uuid", "distance_score" numeric, "job_name" "text", "description" "text", "locations" "text"[], "job_type" "text", "experience" "text")
    LANGUAGE "plpgsql" STABLE
    AS $_$DECLARE
    query_str text;
BEGIN
    -- Construct the full dynamic SQL query
    -- $1=embedding, $2=match_threshold, $3=match_count, $4=min_created_at
    query_str := format('
        SELECT
            all_jobs.id,
            -- FIX: Cast raw distance to NUMERIC(20, 10) for maximum precision transfer
            CAST((all_jobs.embedding_new <=> $1) AS NUMERIC(20, 10)) AS distance_score, 
            all_jobs.job_name,
            all_jobs.description,
            all_jobs.locations,
            all_jobs.job_type::text,
            all_jobs.experience
        FROM all_jobs
        WHERE 
            -- Filter 1: Similarity (Distance must be less than threshold)
            (all_jobs.embedding_new <=> $1) < $2 
            -- Filter 2: Recency (Mandatory)
            AND all_jobs.created_at >= $4 
        ORDER BY (all_jobs.embedding_new <=> $1), all_jobs.id DESC
        LIMIT $3
    '); 

    -- Execute the query, mapping the input arguments to the placeholders
    RETURN QUERY EXECUTE query_str
    USING embedding, match_threshold, match_count, min_created_at; 
END;$_$;


ALTER FUNCTION "public"."match_all_jobs_test"("embedding" "public"."vector", "match_threshold" double precision, "match_count" integer, "min_created_at" timestamp without time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."match_user_profiles"("job_embedding" "public"."vector", "match_threshold" double precision, "match_count" integer) RETURNS TABLE("user_id" "uuid", "full_name" "text", "desired_roles" "text"[], "experience_years" integer, "top_skills" "text"[], "similarity_score" double precision)
    LANGUAGE "sql" STABLE
    AS $$SELECT
    user_info.user_id,
    user_info.full_name,
    user_info.desired_roles,
    user_info.experience_years,
    user_info.top_skills,
    1 - (user_info.embedding_new <=> job_embedding) AS similarity_score
FROM user_info
WHERE (user_info.embedding_new <=> job_embedding) < match_threshold
ORDER BY user_info.embedding_new <=> job_embedding
LIMIT match_count;$$;


ALTER FUNCTION "public"."match_user_profiles"("job_embedding" "public"."vector", "match_threshold" double precision, "match_count" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."normalize_all_job_locations_test"("target_ids" "uuid"[] DEFAULT NULL::"uuid"[]) RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$DECLARE
    job RECORD;
    loc text;
    parts text[];
    comma_parts text[];
    cleaned text;
    city_part text;
    state_part text;
    normalized text[];
    alias_match text;
    canonical_state text;
    is_remote_flag boolean;
BEGIN
    -- Only loop through specified IDs if target_ids is provided
    FOR job IN 
        SELECT id, locations 
        FROM all_jobs 
        WHERE (target_ids IS NULL OR id = ANY(target_ids))
    LOOP
        normalized := ARRAY[]::text[];
        is_remote_flag := false;

        FOREACH loc IN ARRAY job.locations LOOP
            -- 1. Detect Remote status before stripping text
            IF loc ILIKE '%remote%' OR loc ILIKE '%wfh%' OR loc ILIKE '%work from home%' THEN
                is_remote_flag := true;
            END IF;

            -- 2. Strip parentheses and everything inside them
            -- "Bengaluru (Onsite or remote)" -> "Bengaluru"
            loc := regexp_replace(loc, '\s*\(.*?\)', '', 'g');
            
            -- 3. Strip common noise words that might be outside parentheses
            loc := regexp_replace(loc, '(?i)\s*(onsite|hybrid|remote|wfh)', '', 'g');
            loc := trim(loc);

            -- 4. Split by Slash
            parts := string_to_array(loc, '/');

            FOREACH cleaned IN ARRAY parts LOOP
                cleaned := trim(cleaned);
                IF cleaned = '' THEN CONTINUE; END IF;

                -- 5. City, State logic (e.g., "Los Angeles, CA" or "Gurugram, HR")
                IF cleaned LIKE '%,%' THEN
                    comma_parts := string_to_array(cleaned, ',');
                    city_part := trim(comma_parts[1]);

                    IF city_part IS NOT NULL THEN
                        cleaned := city_part;
                    END IF;
                ELSE
                    -- 6. Direct Alias Lookup
                    alias_match := NULL;
                    SELECT canonical_name INTO alias_match
                    FROM location_aliases
                    WHERE LOWER(alias) = LOWER(cleaned)
                    LIMIT 1;

                    IF alias_match IS NOT NULL THEN
                        cleaned := alias_match;
                    END IF;
                END IF;

                cleaned := LOWER(cleaned);
                -- Add to array if not empty and not already present
                IF cleaned <> '' AND NOT (cleaned = ANY(normalized)) THEN
                    normalized := array_append(normalized, cleaned);
                END IF;
            END LOOP;
        END LOOP;

        -- 7. Final Remote Check
        IF is_remote_flag AND NOT ('remote' = ANY(normalized)) THEN
            -- We use array_prepend to put 'Remote' at the start
            normalized := array_prepend('remote', normalized);
        END IF;

        UPDATE all_jobs
        SET normalized_locations = normalized
        WHERE id = job.id;
    END LOOP;
END;$$;


ALTER FUNCTION "public"."normalize_all_job_locations_test"("target_ids" "uuid"[]) OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."all_jobs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "job_url" "text",
    "locations" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "job_type" "public"."job_type_enum" DEFAULT 'Fulltime'::"public"."job_type_enum" NOT NULL,
    "visa_requirement" "text",
    "salary_range" "text",
    "salary_min" double precision,
    "salary_max" double precision,
    "equity_range" "text",
    "equity_min" double precision,
    "equity_max" double precision,
    "job_name" "text",
    "experience" "text",
    "experience_min" bigint DEFAULT '0'::bigint NOT NULL,
    "experience_max" bigint,
    "company_url" "text",
    "description" "text",
    "company_name" "text",
    "platform" "text",
    "embedding" "public"."vector"(384),
    "embedding_updated_at" timestamp with time zone,
    "status" "public"."job_posting_status" DEFAULT 'active'::"public"."job_posting_status" NOT NULL,
    "normalized_locations" "text"[],
    "ai_summary" "text",
    "embedding_new" "public"."vector"(768)
);


ALTER TABLE "public"."all_jobs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."all_jobs_archive" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "job_url" "text",
    "locations" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "job_type" "text",
    "visa_requirement" "text",
    "salary_range" "text",
    "salary_min" bigint,
    "salary_max" bigint,
    "equity_range" "text",
    "equity_min" double precision,
    "equity_max" double precision,
    "job_name" "text",
    "experience" "text",
    "experience_min" bigint,
    "experience_max" bigint,
    "company_url" "text",
    "description" "text",
    "company_name" "text",
    "platform" "text",
    "embedding" "public"."vector"(384),
    "embedding_updated_at" timestamp with time zone,
    "status" "public"."job_posting_status" DEFAULT 'active'::"public"."job_posting_status" NOT NULL,
    "normalized_locations" "text"[],
    "ai_summary" "text",
    "embedding_new" "public"."vector"(768)
);


ALTER TABLE "public"."all_jobs_archive" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."applications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "job_post_id" "uuid",
    "resume_url" "text",
    "status" "public"."application_status" DEFAULT 'submitted'::"public"."application_status" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "answers" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "applicant_user_id" "uuid",
    "all_jobs_id" "uuid",
    "resume_path" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "resume_id" "uuid"
);


ALTER TABLE "public"."applications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bookmarks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "url" "text",
    "user_id" "uuid",
    "name" "text" NOT NULL,
    "is_alert_on" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."bookmarks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."company_favorites" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "company_id" "uuid",
    "user_info_id" "uuid"
);


ALTER TABLE "public"."company_favorites" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."company_info" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text",
    "description" "text",
    "website" "text",
    "industry" "text",
    "headquarters" "text",
    "company_size" "text",
    "logo_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "filled" boolean DEFAULT false NOT NULL,
    "ai_search_uses" bigint DEFAULT '0'::bigint NOT NULL,
    "tag_line" "text",
    "embedding" "public"."vector",
    "embedding_updated_at" timestamp with time zone,
    "ai_credits" smallint DEFAULT '50'::smallint NOT NULL,
    "embedding_new" "public"."vector"(768)
);


ALTER TABLE "public"."company_info" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."countries_and_cities" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "country" "text",
    "iso" "text",
    "cities" "text"[]
);


ALTER TABLE "public"."countries_and_cities" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."feedbacks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "content" "text",
    "user_id" "uuid",
    "company_user_id" "uuid"
);


ALTER TABLE "public"."feedbacks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."invitations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "referrer_user_id" "uuid",
    "invited_email" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "isDialogShown" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."invitations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."job_feedback" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "job_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "vote_type" "public"."job_feedback_vote" DEFAULT 'upvote'::"public"."job_feedback_vote" NOT NULL
);


ALTER TABLE "public"."job_feedback" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."job_postings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "job_type" "public"."job_type_enum" DEFAULT 'Fulltime'::"public"."job_type_enum" NOT NULL,
    "salary_range" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "status" "public"."job_posting_status" DEFAULT 'inactive'::"public"."job_posting_status" NOT NULL,
    "location" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "min_salary" bigint,
    "max_salary" bigint,
    "min_experience" bigint,
    "max_experience" bigint,
    "visa_sponsorship" "public"."visa_job_postings" DEFAULT 'Not Required'::"public"."visa_job_postings" NOT NULL,
    "min_equity" double precision,
    "max_equity" double precision,
    "experience" "text",
    "equity_range" "text",
    "salary_currency" "text",
    "questions" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "job_id" "uuid",
    "embedding" "public"."vector"(384),
    "embedding_updated_at" timestamp with time zone,
    "embedding_new" "public"."vector"(768)
);


ALTER TABLE "public"."job_postings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."location_aliases" (
    "alias" "text" NOT NULL,
    "canonical_name" "text" NOT NULL
);


ALTER TABLE "public"."location_aliases" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "user_id" "uuid",
    "status" "public"."payment_status" DEFAULT 'pending'::"public"."payment_status" NOT NULL,
    "product_id" "text",
    "price_plan_id" "uuid",
    "credit_amount" smallint,
    "currency" "text",
    "credits_fulfilled" boolean,
    "fulfillment_date" timestamp with time zone,
    "session_id" "text",
    "failure_reason" "text",
    "payment_id" "text",
    "total_amount" bigint,
    "customer" "jsonb",
    "billing" "jsonb",
    "email_sent" boolean
);


ALTER TABLE "public"."payments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."price_plan" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "credit_amount" smallint,
    "product_id" "text",
    "name" "text",
    "description" "text",
    "amount" real,
    "currency" "text"
);


ALTER TABLE "public"."price_plan" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."resume_reviews" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "user_id" "uuid",
    "job_id" "uuid",
    "ai_response" "jsonb",
    "score" double precision,
    "target_jd" "text",
    "status" "text",
    "resume_id" "uuid",
    "name" "text",
    "analysis_failed" boolean
);


ALTER TABLE "public"."resume_reviews" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."resumes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "name" "text",
    "user_id" "uuid",
    "resume_path" "text",
    "content" "jsonb",
    "is_primary" boolean DEFAULT false NOT NULL,
    "parsing_failed" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."resumes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."scraper_state" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone,
    "oldest_company_url" "text",
    "newest_company_url" "text",
    "type" "text",
    "historical_scraped_urls" "text"[] DEFAULT '{}'::"text"[] NOT NULL
);


ALTER TABLE "public"."scraper_state" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_api_tokens" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "token_hash" "text" NOT NULL,
    "name" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "last_used_at" timestamp with time zone
);


ALTER TABLE "public"."user_api_tokens" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_favorites" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "user_id" "uuid",
    "job_id" "uuid"
);


ALTER TABLE "public"."user_favorites" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_favorites_companies" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "user_id" "uuid",
    "company_id" "uuid"
);


ALTER TABLE "public"."user_favorites_companies" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_info" (
    "user_id" "uuid" NOT NULL,
    "desired_roles" "text"[],
    "preferred_locations" "text"[],
    "min_salary" integer,
    "max_salary" integer,
    "experience_years" integer,
    "industry_preferences" "text"[],
    "visa_sponsorship_required" boolean,
    "top_skills" "text"[],
    "work_style_preferences" "text"[],
    "career_goals_short_term" "text",
    "career_goals_long_term" "text",
    "company_size_preference" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "job_type" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "filled" boolean DEFAULT false NOT NULL,
    "full_name" "text",
    "email" "text",
    "salary_currency" "text" DEFAULT '$'::"text" NOT NULL,
    "is_job_digest_active" boolean DEFAULT false NOT NULL,
    "is_promotion_active" boolean DEFAULT false NOT NULL,
    "last_promo_version_seen" "text",
    "linkedin_url" "text",
    "github_url" "text",
    "ai_credits" smallint DEFAULT '25'::smallint NOT NULL,
    "referral_code" "text" DEFAULT "gen_random_uuid"(),
    "invitations_count" smallint DEFAULT '0'::smallint NOT NULL,
    "is_relevant_jobs_generated" boolean DEFAULT false NOT NULL,
    "embedding_new" "public"."vector"(768),
    "is_relevant_job_update_failed" boolean DEFAULT false NOT NULL,
    "is_public" boolean DEFAULT true NOT NULL,
    CONSTRAINT "user_info_ai_credits_check" CHECK (("ai_credits" >= 0))
);


ALTER TABLE "public"."user_info" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_relevant_jobs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "user_id" "uuid",
    "jobs_id" "uuid",
    "relevance_rank" bigint
);


ALTER TABLE "public"."user_relevant_jobs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."waitlist" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "email" "text" NOT NULL,
    "type" "text"
);


ALTER TABLE "public"."waitlist" OWNER TO "postgres";


ALTER TABLE ONLY "public"."all_jobs_archive"
    ADD CONSTRAINT "all_jobs_archive_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."applications"
    ADD CONSTRAINT "applications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bookmarks"
    ADD CONSTRAINT "bookmarks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."company_favorites"
    ADD CONSTRAINT "company_favorites_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."company_info"
    ADD CONSTRAINT "company_info_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."countries_and_cities"
    ADD CONSTRAINT "countries_and_cities_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."feedbacks"
    ADD CONSTRAINT "feedbacks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invitations"
    ADD CONSTRAINT "invitations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."job_feedback"
    ADD CONSTRAINT "job_feedback_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."job_postings"
    ADD CONSTRAINT "job_postings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."location_aliases"
    ADD CONSTRAINT "location_aliases_pkey" PRIMARY KEY ("alias");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."price_plan"
    ADD CONSTRAINT "price_plan_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."resume_reviews"
    ADD CONSTRAINT "resume_reviews_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."resumes"
    ADD CONSTRAINT "resumes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."scraper_state"
    ADD CONSTRAINT "scraper_state_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."scraper_state"
    ADD CONSTRAINT "scraper_state_type_unique" UNIQUE ("type");



ALTER TABLE ONLY "public"."company_info"
    ADD CONSTRAINT "unique_user_id" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."job_feedback"
    ADD CONSTRAINT "unique_user_job_vote" UNIQUE ("user_id", "job_id");



ALTER TABLE ONLY "public"."all_jobs"
    ADD CONSTRAINT "uplers_job_postings_job_url_key" UNIQUE ("job_url");



ALTER TABLE ONLY "public"."all_jobs"
    ADD CONSTRAINT "uplers_job_postings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_api_tokens"
    ADD CONSTRAINT "user_api_tokens_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."user_api_tokens"
    ADD CONSTRAINT "user_api_tokens_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_api_tokens"
    ADD CONSTRAINT "user_api_tokens_token_hash_key" UNIQUE ("token_hash");



ALTER TABLE ONLY "public"."user_favorites_companies"
    ADD CONSTRAINT "user_favorites_companies_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_favorites"
    ADD CONSTRAINT "user_favorites_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_favorites"
    ADD CONSTRAINT "user_favorites_unique" UNIQUE ("user_id", "job_id");



ALTER TABLE ONLY "public"."user_info"
    ADD CONSTRAINT "user_info_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."user_relevant_jobs"
    ADD CONSTRAINT "user_relevant_jobs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."waitlist"
    ADD CONSTRAINT "waitlist_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."waitlist"
    ADD CONSTRAINT "waitlist_pkey" PRIMARY KEY ("id");



CREATE INDEX "all_jobs_embedding_idx" ON "public"."all_jobs" USING "hnsw" ("embedding" "public"."vector_cosine_ops");



CREATE INDEX "idx_all_jobs_active_created" ON "public"."all_jobs" USING "btree" ("status", "created_at" DESC);



CREATE INDEX "idx_all_jobs_job_name_fts" ON "public"."all_jobs" USING "gin" ("to_tsvector"('"english"'::"regconfig", "job_name"));



CREATE INDEX "idx_all_jobs_job_type" ON "public"."all_jobs" USING "btree" ("job_type");



CREATE INDEX "idx_all_jobs_normalized_locations" ON "public"."all_jobs" USING "gin" ("normalized_locations");



CREATE INDEX "idx_all_jobs_salary_min" ON "public"."all_jobs" USING "btree" ("salary_min");



CREATE INDEX "idx_all_jobs_status" ON "public"."all_jobs" USING "btree" ("status");



CREATE INDEX "idx_applications_composite" ON "public"."applications" USING "btree" ("applicant_user_id", "all_jobs_id");



CREATE INDEX "idx_user_favorites_composite" ON "public"."user_favorites" USING "btree" ("user_id", "job_id");



CREATE UNIQUE INDEX "idx_user_info_referral_code" ON "public"."user_info" USING "btree" ("referral_code");



CREATE INDEX "idx_user_relevant_jobs_user_id_rank" ON "public"."user_relevant_jobs" USING "btree" ("user_id", "relevance_rank");



CREATE INDEX "job_postings_embedding_idx" ON "public"."job_postings" USING "hnsw" ("embedding" "public"."vector_cosine_ops");



CREATE OR REPLACE TRIGGER "on_job_posting_update" AFTER INSERT ON "public"."job_postings" FOR EACH ROW EXECUTE FUNCTION "public"."handle_job_posting_embedding"();



CREATE OR REPLACE TRIGGER "on_job_update" AFTER INSERT ON "public"."all_jobs" FOR EACH ROW EXECUTE FUNCTION "public"."handle_job_embedding"();



ALTER TABLE ONLY "public"."applications"
    ADD CONSTRAINT "applications_all_jobs_id_fkey" FOREIGN KEY ("all_jobs_id") REFERENCES "public"."all_jobs"("id") ON UPDATE CASCADE ON DELETE SET NULL;



ALTER TABLE ONLY "public"."applications"
    ADD CONSTRAINT "applications_applicant_user_id_fkey" FOREIGN KEY ("applicant_user_id") REFERENCES "public"."user_info"("user_id") ON UPDATE CASCADE ON DELETE SET NULL;



ALTER TABLE ONLY "public"."applications"
    ADD CONSTRAINT "applications_job_post_id_fkey" FOREIGN KEY ("job_post_id") REFERENCES "public"."job_postings"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."applications"
    ADD CONSTRAINT "applications_resume_id_fkey" FOREIGN KEY ("resume_id") REFERENCES "public"."resumes"("id") ON UPDATE CASCADE ON DELETE SET NULL;



ALTER TABLE ONLY "public"."bookmarks"
    ADD CONSTRAINT "bookmarks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user_info"("user_id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."company_favorites"
    ADD CONSTRAINT "company_favorites_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."company_info"("id") ON UPDATE CASCADE ON DELETE SET NULL;



ALTER TABLE ONLY "public"."company_favorites"
    ADD CONSTRAINT "company_favorites_user_info_id_fkey" FOREIGN KEY ("user_info_id") REFERENCES "public"."user_info"("user_id") ON UPDATE CASCADE ON DELETE SET NULL;



ALTER TABLE ONLY "public"."company_info"
    ADD CONSTRAINT "company_info_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."feedbacks"
    ADD CONSTRAINT "feedbacks_company_user_id_fkey" FOREIGN KEY ("company_user_id") REFERENCES "public"."company_info"("user_id") ON UPDATE CASCADE ON DELETE SET NULL;



ALTER TABLE ONLY "public"."feedbacks"
    ADD CONSTRAINT "feedbacks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user_info"("user_id") ON UPDATE CASCADE ON DELETE SET NULL;



ALTER TABLE ONLY "public"."invitations"
    ADD CONSTRAINT "invitations_referrer_user_id_fkey" FOREIGN KEY ("referrer_user_id") REFERENCES "public"."user_info"("user_id") ON UPDATE CASCADE ON DELETE SET NULL;



ALTER TABLE ONLY "public"."job_feedback"
    ADD CONSTRAINT "job_feedback_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "public"."all_jobs"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."job_feedback"
    ADD CONSTRAINT "job_feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user_info"("user_id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."job_postings"
    ADD CONSTRAINT "job_postings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."company_info"("id");



ALTER TABLE ONLY "public"."job_postings"
    ADD CONSTRAINT "job_postings_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "public"."all_jobs"("id") ON UPDATE CASCADE ON DELETE SET NULL;



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_price_plan_id_fkey" FOREIGN KEY ("price_plan_id") REFERENCES "public"."price_plan"("id") ON UPDATE CASCADE ON DELETE SET NULL;



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user_info"("user_id") ON UPDATE CASCADE ON DELETE SET NULL;



ALTER TABLE ONLY "public"."resume_reviews"
    ADD CONSTRAINT "resume_reviews_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "public"."all_jobs"("id") ON UPDATE CASCADE ON DELETE SET NULL;



ALTER TABLE ONLY "public"."resume_reviews"
    ADD CONSTRAINT "resume_reviews_resume_id_fkey" FOREIGN KEY ("resume_id") REFERENCES "public"."resumes"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."resume_reviews"
    ADD CONSTRAINT "resume_reviews_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user_info"("user_id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."resumes"
    ADD CONSTRAINT "resumes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user_info"("user_id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_api_tokens"
    ADD CONSTRAINT "user_api_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user_info"("user_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_favorites_companies"
    ADD CONSTRAINT "user_favorites_companies_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."company_info"("id") ON UPDATE CASCADE ON DELETE SET NULL;



ALTER TABLE ONLY "public"."user_favorites_companies"
    ADD CONSTRAINT "user_favorites_companies_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user_info"("user_id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_favorites"
    ADD CONSTRAINT "user_favorites_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "public"."all_jobs"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_favorites"
    ADD CONSTRAINT "user_favorites_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user_info"("user_id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_info"
    ADD CONSTRAINT "user_info_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."user_relevant_jobs"
    ADD CONSTRAINT "user_relevant_jobs_jobs_id_fkey" FOREIGN KEY ("jobs_id") REFERENCES "public"."all_jobs"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_relevant_jobs"
    ADD CONSTRAINT "user_relevant_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user_info"("user_id") ON UPDATE CASCADE ON DELETE CASCADE;



CREATE POLICY "Allow all users to select" ON "public"."all_jobs" FOR SELECT USING (true);



CREATE POLICY "Allow authenticated users to SELECT" ON "public"."price_plan" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Allow companies to view applicant info" ON "public"."user_info" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."company_info"
  WHERE ("company_info"."user_id" = "auth"."uid"()))));



CREATE POLICY "Company can add profiles to favorites" ON "public"."company_favorites" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."company_info"
  WHERE (("company_info"."user_id" = "auth"."uid"()) AND ("company_info"."id" = "company_favorites"."company_id")))));



CREATE POLICY "Company can create job postings" ON "public"."job_postings" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."company_info"
  WHERE (("company_info"."user_id" = "auth"."uid"()) AND ("company_info"."id" = "job_postings"."company_id")))));



CREATE POLICY "Company can delete their own job postings" ON "public"."job_postings" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."company_info"
  WHERE (("company_info"."user_id" = "auth"."uid"()) AND ("company_info"."id" = "job_postings"."company_id")))));



CREATE POLICY "Company can remove profiles from favorites" ON "public"."company_favorites" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."company_info"
  WHERE (("company_info"."user_id" = "auth"."uid"()) AND ("company_info"."id" = "company_favorites"."company_id")))));



CREATE POLICY "Company can update applications for their jobs" ON "public"."applications" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."job_postings"
     JOIN "public"."company_info" ON (("job_postings"."company_id" = "company_info"."id")))
  WHERE (("job_postings"."id" = "applications"."job_post_id") AND ("company_info"."user_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."job_postings"
     JOIN "public"."company_info" ON (("job_postings"."company_id" = "company_info"."id")))
  WHERE (("job_postings"."id" = "applications"."job_post_id") AND ("company_info"."user_id" = "auth"."uid"())))));



CREATE POLICY "Company can update their own job postings" ON "public"."job_postings" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."company_info"
  WHERE (("company_info"."user_id" = "auth"."uid"()) AND ("company_info"."id" = "job_postings"."company_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."company_info"
  WHERE (("company_info"."user_id" = "auth"."uid"()) AND ("company_info"."id" = "job_postings"."company_id")))));



CREATE POLICY "Company can update their own job records" ON "public"."all_jobs" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."job_postings"
     JOIN "public"."company_info" ON (("job_postings"."company_id" = "company_info"."id")))
  WHERE (("all_jobs"."id" = "job_postings"."job_id") AND ("company_info"."user_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."job_postings"
     JOIN "public"."company_info" ON (("job_postings"."company_id" = "company_info"."id")))
  WHERE (("all_jobs"."id" = "job_postings"."job_id") AND ("company_info"."user_id" = "auth"."uid"())))));



CREATE POLICY "Company can update their own profile" ON "public"."company_info" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Company can view applications for their jobs" ON "public"."applications" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."job_postings"
     JOIN "public"."company_info" ON (("job_postings"."company_id" = "company_info"."id")))
  WHERE (("job_postings"."id" = "applications"."job_post_id") AND ("company_info"."user_id" = "auth"."uid"())))));



CREATE POLICY "Company can view their own favorites" ON "public"."company_favorites" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."company_info"
  WHERE (("company_info"."user_id" = "auth"."uid"()) AND ("company_info"."id" = "company_favorites"."company_id")))));



CREATE POLICY "Company can view their own job postings" ON "public"."job_postings" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."company_info"
  WHERE (("company_info"."user_id" = "auth"."uid"()) AND ("company_info"."id" = "job_postings"."company_id")))));



CREATE POLICY "Company user can create Application" ON "public"."applications" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."job_postings"
     JOIN "public"."company_info" ON (("job_postings"."company_id" = "company_info"."id")))
  WHERE (("job_postings"."id" = "applications"."job_post_id") AND ("company_info"."user_id" = "auth"."uid"())))));



CREATE POLICY "Enable all for users based on user_id" ON "public"."resumes" TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Enable delete for users based on user_id" ON "public"."bookmarks" FOR DELETE USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Enable delete for users based on user_id" ON "public"."user_favorites" FOR DELETE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Enable delete for users based on user_id" ON "public"."user_favorites_companies" FOR DELETE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Enable insert for users based on user_id" ON "public"."bookmarks" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Enable insert for users based on user_id" ON "public"."feedbacks" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Enable insert for users based on user_id" ON "public"."user_favorites" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Enable insert for users based on user_id" ON "public"."user_favorites_companies" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Enable insert for users based on user_id" ON "public"."user_info" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Enable read access for all users" ON "public"."countries_and_cities" FOR SELECT USING (true);



CREATE POLICY "Enable users all on their own data only" ON "public"."resume_reviews" TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Enable users to interact with their own data only" ON "public"."invitations" TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "referrer_user_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "referrer_user_id"));



CREATE POLICY "Enable users to view their own data only" ON "public"."bookmarks" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Enable users to view their own data only" ON "public"."payments" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Enable users to view their own data only" ON "public"."user_favorites" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Enable users to view their own data only" ON "public"."user_favorites_companies" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Enable users to view their own data only" ON "public"."user_relevant_jobs" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Insert access to public role" ON "public"."company_info" FOR INSERT WITH CHECK (true);



CREATE POLICY "Job seeker can create their own application" ON "public"."applications" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "applicant_user_id"));



CREATE POLICY "Job seeker can update their application" ON "public"."applications" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "applicant_user_id")) WITH CHECK (("auth"."uid"() = "applicant_user_id"));



CREATE POLICY "Job seeker can view their own applications" ON "public"."applications" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "applicant_user_id"));



CREATE POLICY "Job seekers can view job postings" ON "public"."job_postings" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Public and company users can view company profiles" ON "public"."company_info" FOR SELECT USING (true);



CREATE POLICY "User can only update their record" ON "public"."bookmarks" FOR UPDATE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Users can manage own tokens" ON "public"."user_api_tokens" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can manage their own feedback" ON "public"."job_feedback" TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can read their own user_info" ON "public"."user_info" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."all_jobs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."all_jobs_archive" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."applications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."bookmarks" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "company user select all" ON "public"."resumes" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."company_info"
  WHERE ("company_info"."user_id" = "auth"."uid"()))));



ALTER TABLE "public"."company_favorites" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."company_info" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."countries_and_cities" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."feedbacks" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "insert access to all" ON "public"."waitlist" FOR INSERT WITH CHECK (true);



ALTER TABLE "public"."invitations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."job_feedback" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."job_postings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."location_aliases" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."payments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."price_plan" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."resume_reviews" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."resumes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."scraper_state" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user can update their record" ON "public"."user_info" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."user_api_tokens" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_favorites" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_favorites_companies" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_info" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_relevant_jobs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."waitlist" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";





GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";






GRANT ALL ON FUNCTION "public"."halfvec_in"("cstring", "oid", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_in"("cstring", "oid", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_in"("cstring", "oid", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_in"("cstring", "oid", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_out"("public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_out"("public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_out"("public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_out"("public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_recv"("internal", "oid", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_recv"("internal", "oid", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_recv"("internal", "oid", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_recv"("internal", "oid", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_send"("public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_send"("public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_send"("public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_send"("public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_typmod_in"("cstring"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_typmod_in"("cstring"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_typmod_in"("cstring"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_typmod_in"("cstring"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_in"("cstring", "oid", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_in"("cstring", "oid", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_in"("cstring", "oid", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_in"("cstring", "oid", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_out"("public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_out"("public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_out"("public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_out"("public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_recv"("internal", "oid", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_recv"("internal", "oid", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_recv"("internal", "oid", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_recv"("internal", "oid", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_send"("public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_send"("public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_send"("public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_send"("public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_typmod_in"("cstring"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_typmod_in"("cstring"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_typmod_in"("cstring"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_typmod_in"("cstring"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_in"("cstring", "oid", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_in"("cstring", "oid", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."vector_in"("cstring", "oid", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_in"("cstring", "oid", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_out"("public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_out"("public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_out"("public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_out"("public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_recv"("internal", "oid", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_recv"("internal", "oid", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."vector_recv"("internal", "oid", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_recv"("internal", "oid", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_send"("public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_send"("public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_send"("public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_send"("public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_typmod_in"("cstring"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_typmod_in"("cstring"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."vector_typmod_in"("cstring"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_typmod_in"("cstring"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_halfvec"(real[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(real[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(real[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(real[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(real[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(real[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(real[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(real[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_vector"(real[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_vector"(real[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_vector"(real[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_vector"(real[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_halfvec"(double precision[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(double precision[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(double precision[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(double precision[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(double precision[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(double precision[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(double precision[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(double precision[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_vector"(double precision[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_vector"(double precision[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_vector"(double precision[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_vector"(double precision[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_halfvec"(integer[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(integer[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(integer[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(integer[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(integer[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(integer[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(integer[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(integer[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_vector"(integer[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_vector"(integer[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_vector"(integer[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_vector"(integer[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_halfvec"(numeric[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(numeric[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(numeric[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(numeric[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(numeric[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(numeric[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(numeric[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(numeric[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_vector"(numeric[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_vector"(numeric[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_vector"(numeric[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_vector"(numeric[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_to_float4"("public"."halfvec", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_to_float4"("public"."halfvec", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_to_float4"("public"."halfvec", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_to_float4"("public"."halfvec", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec"("public"."halfvec", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec"("public"."halfvec", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec"("public"."halfvec", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec"("public"."halfvec", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_to_sparsevec"("public"."halfvec", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_to_sparsevec"("public"."halfvec", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_to_sparsevec"("public"."halfvec", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_to_sparsevec"("public"."halfvec", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_to_vector"("public"."halfvec", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_to_vector"("public"."halfvec", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_to_vector"("public"."halfvec", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_to_vector"("public"."halfvec", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_to_halfvec"("public"."sparsevec", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_to_halfvec"("public"."sparsevec", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_to_halfvec"("public"."sparsevec", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_to_halfvec"("public"."sparsevec", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec"("public"."sparsevec", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec"("public"."sparsevec", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec"("public"."sparsevec", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec"("public"."sparsevec", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_to_vector"("public"."sparsevec", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_to_vector"("public"."sparsevec", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_to_vector"("public"."sparsevec", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_to_vector"("public"."sparsevec", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_to_float4"("public"."vector", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_to_float4"("public"."vector", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."vector_to_float4"("public"."vector", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_to_float4"("public"."vector", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_to_halfvec"("public"."vector", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_to_halfvec"("public"."vector", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."vector_to_halfvec"("public"."vector", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_to_halfvec"("public"."vector", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_to_sparsevec"("public"."vector", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_to_sparsevec"("public"."vector", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."vector_to_sparsevec"("public"."vector", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_to_sparsevec"("public"."vector", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector"("public"."vector", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector"("public"."vector", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."vector"("public"."vector", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector"("public"."vector", integer, boolean) TO "service_role";











































































































































































GRANT ALL ON FUNCTION "public"."algorithm_sign"("signables" "text", "secret" "text", "algorithm" "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."algorithm_sign"("signables" "text", "secret" "text", "algorithm" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."algorithm_sign"("signables" "text", "secret" "text", "algorithm" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."algorithm_sign"("signables" "text", "secret" "text", "algorithm" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."binary_quantize"("public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."binary_quantize"("public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."binary_quantize"("public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."binary_quantize"("public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."binary_quantize"("public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."binary_quantize"("public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."binary_quantize"("public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."binary_quantize"("public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."deduct_user_credits"("p_user_id" "uuid", "p_amount" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."deduct_user_credits"("p_user_id" "uuid", "p_amount" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."deduct_user_credits"("p_user_id" "uuid", "p_amount" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_applicant_weekly_metrics"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_applicant_weekly_metrics"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_applicant_weekly_metrics"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_company_metrics"("company_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_company_metrics"("company_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_company_metrics"("company_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_unique_companies"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_unique_companies"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_unique_companies"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_unique_companies_company_info"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_unique_companies_company_info"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_unique_companies_company_info"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_unique_locations"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_unique_locations"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_unique_locations"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_unique_locations_company_info"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_unique_locations_company_info"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_unique_locations_company_info"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_unique_profile_filters"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_unique_profile_filters"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_unique_profile_filters"() TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_accum"(double precision[], "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_accum"(double precision[], "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_accum"(double precision[], "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_accum"(double precision[], "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_add"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_add"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_add"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_add"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_avg"(double precision[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_avg"(double precision[]) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_avg"(double precision[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_avg"(double precision[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_cmp"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_cmp"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_cmp"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_cmp"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_combine"(double precision[], double precision[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_combine"(double precision[], double precision[]) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_combine"(double precision[], double precision[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_combine"(double precision[], double precision[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_concat"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_concat"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_concat"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_concat"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_eq"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_eq"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_eq"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_eq"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_ge"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_ge"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_ge"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_ge"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_gt"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_gt"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_gt"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_gt"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_l2_squared_distance"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_l2_squared_distance"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_l2_squared_distance"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_l2_squared_distance"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_le"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_le"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_le"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_le"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_lt"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_lt"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_lt"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_lt"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_mul"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_mul"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_mul"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_mul"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_ne"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_ne"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_ne"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_ne"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_negative_inner_product"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_negative_inner_product"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_negative_inner_product"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_negative_inner_product"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_spherical_distance"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_spherical_distance"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_spherical_distance"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_spherical_distance"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_sub"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_sub"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_sub"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_sub"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."hamming_distance"(bit, bit) TO "postgres";
GRANT ALL ON FUNCTION "public"."hamming_distance"(bit, bit) TO "anon";
GRANT ALL ON FUNCTION "public"."hamming_distance"(bit, bit) TO "authenticated";
GRANT ALL ON FUNCTION "public"."hamming_distance"(bit, bit) TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_job_embedding"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_job_embedding"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_job_embedding"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_job_posting_embedding"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_job_posting_embedding"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_job_posting_embedding"() TO "service_role";



GRANT ALL ON FUNCTION "public"."hnsw_bit_support"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."hnsw_bit_support"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."hnsw_bit_support"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hnsw_bit_support"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."hnsw_halfvec_support"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."hnsw_halfvec_support"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."hnsw_halfvec_support"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hnsw_halfvec_support"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."hnsw_sparsevec_support"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."hnsw_sparsevec_support"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."hnsw_sparsevec_support"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hnsw_sparsevec_support"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."hnswhandler"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."hnswhandler"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."hnswhandler"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hnswhandler"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."inner_product"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."inner_product"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."inner_product"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."ivfflat_bit_support"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."ivfflat_bit_support"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."ivfflat_bit_support"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ivfflat_bit_support"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."ivfflat_halfvec_support"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."ivfflat_halfvec_support"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."ivfflat_halfvec_support"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ivfflat_halfvec_support"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."ivfflathandler"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."ivfflathandler"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."ivfflathandler"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ivfflathandler"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."jaccard_distance"(bit, bit) TO "postgres";
GRANT ALL ON FUNCTION "public"."jaccard_distance"(bit, bit) TO "anon";
GRANT ALL ON FUNCTION "public"."jaccard_distance"(bit, bit) TO "authenticated";
GRANT ALL ON FUNCTION "public"."jaccard_distance"(bit, bit) TO "service_role";



GRANT ALL ON FUNCTION "public"."l1_distance"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."l1_distance"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."l1_distance"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."l2_distance"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."l2_distance"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."l2_distance"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."l2_norm"("public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."l2_norm"("public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."l2_norm"("public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l2_norm"("public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."l2_norm"("public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."l2_norm"("public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."l2_norm"("public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l2_norm"("public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."match_all_companies"("query_embedding" "public"."vector", "match_threshold" double precision, "match_count" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."match_all_companies"("query_embedding" "public"."vector", "match_threshold" double precision, "match_count" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."match_all_companies"("query_embedding" "public"."vector", "match_threshold" double precision, "match_count" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."match_all_jobs_test"("embedding" "public"."vector", "match_threshold" double precision, "match_count" integer, "min_created_at" timestamp without time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."match_all_jobs_test"("embedding" "public"."vector", "match_threshold" double precision, "match_count" integer, "min_created_at" timestamp without time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."match_all_jobs_test"("embedding" "public"."vector", "match_threshold" double precision, "match_count" integer, "min_created_at" timestamp without time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."match_user_profiles"("job_embedding" "public"."vector", "match_threshold" double precision, "match_count" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."match_user_profiles"("job_embedding" "public"."vector", "match_threshold" double precision, "match_count" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."match_user_profiles"("job_embedding" "public"."vector", "match_threshold" double precision, "match_count" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."normalize_all_job_locations_test"("target_ids" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."normalize_all_job_locations_test"("target_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."normalize_all_job_locations_test"("target_ids" "uuid"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."sign"("payload" "json", "secret" "text", "algorithm" "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."sign"("payload" "json", "secret" "text", "algorithm" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."sign"("payload" "json", "secret" "text", "algorithm" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sign"("payload" "json", "secret" "text", "algorithm" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_cmp"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_cmp"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_cmp"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_cmp"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_eq"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_eq"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_eq"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_eq"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_ge"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_ge"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_ge"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_ge"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_gt"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_gt"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_gt"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_gt"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_l2_squared_distance"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_l2_squared_distance"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_l2_squared_distance"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_l2_squared_distance"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_le"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_le"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_le"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_le"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_lt"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_lt"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_lt"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_lt"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_ne"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_ne"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_ne"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_ne"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_negative_inner_product"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_negative_inner_product"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_negative_inner_product"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_negative_inner_product"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."subvector"("public"."halfvec", integer, integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."subvector"("public"."halfvec", integer, integer) TO "anon";
GRANT ALL ON FUNCTION "public"."subvector"("public"."halfvec", integer, integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."subvector"("public"."halfvec", integer, integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."subvector"("public"."vector", integer, integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."subvector"("public"."vector", integer, integer) TO "anon";
GRANT ALL ON FUNCTION "public"."subvector"("public"."vector", integer, integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."subvector"("public"."vector", integer, integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."try_cast_double"("inp" "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."try_cast_double"("inp" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."try_cast_double"("inp" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."try_cast_double"("inp" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."url_decode"("data" "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."url_decode"("data" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."url_decode"("data" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."url_decode"("data" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."url_encode"("data" "bytea") TO "postgres";
GRANT ALL ON FUNCTION "public"."url_encode"("data" "bytea") TO "anon";
GRANT ALL ON FUNCTION "public"."url_encode"("data" "bytea") TO "authenticated";
GRANT ALL ON FUNCTION "public"."url_encode"("data" "bytea") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_accum"(double precision[], "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_accum"(double precision[], "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_accum"(double precision[], "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_accum"(double precision[], "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_add"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_add"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_add"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_add"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_avg"(double precision[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_avg"(double precision[]) TO "anon";
GRANT ALL ON FUNCTION "public"."vector_avg"(double precision[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_avg"(double precision[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_cmp"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_cmp"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_cmp"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_cmp"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_combine"(double precision[], double precision[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_combine"(double precision[], double precision[]) TO "anon";
GRANT ALL ON FUNCTION "public"."vector_combine"(double precision[], double precision[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_combine"(double precision[], double precision[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_concat"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_concat"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_concat"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_concat"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_dims"("public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_dims"("public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_dims"("public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_dims"("public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_dims"("public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_dims"("public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_dims"("public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_dims"("public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_eq"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_eq"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_eq"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_eq"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_ge"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_ge"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_ge"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_ge"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_gt"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_gt"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_gt"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_gt"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_l2_squared_distance"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_l2_squared_distance"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_l2_squared_distance"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_l2_squared_distance"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_le"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_le"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_le"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_le"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_lt"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_lt"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_lt"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_lt"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_mul"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_mul"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_mul"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_mul"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_ne"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_ne"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_ne"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_ne"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_negative_inner_product"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_negative_inner_product"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_negative_inner_product"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_negative_inner_product"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_norm"("public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_norm"("public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_norm"("public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_norm"("public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_spherical_distance"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_spherical_distance"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_spherical_distance"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_spherical_distance"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_sub"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_sub"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_sub"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_sub"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."verify"("token" "text", "secret" "text", "algorithm" "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."verify"("token" "text", "secret" "text", "algorithm" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."verify"("token" "text", "secret" "text", "algorithm" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."verify"("token" "text", "secret" "text", "algorithm" "text") TO "service_role";












GRANT ALL ON FUNCTION "public"."avg"("public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."avg"("public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."avg"("public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."avg"("public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."avg"("public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."avg"("public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."avg"("public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."avg"("public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."sum"("public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sum"("public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."sum"("public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sum"("public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sum"("public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."sum"("public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."sum"("public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sum"("public"."vector") TO "service_role";















GRANT ALL ON TABLE "public"."all_jobs" TO "anon";
GRANT ALL ON TABLE "public"."all_jobs" TO "authenticated";
GRANT ALL ON TABLE "public"."all_jobs" TO "service_role";



GRANT ALL ON TABLE "public"."all_jobs_archive" TO "anon";
GRANT ALL ON TABLE "public"."all_jobs_archive" TO "authenticated";
GRANT ALL ON TABLE "public"."all_jobs_archive" TO "service_role";



GRANT ALL ON TABLE "public"."applications" TO "anon";
GRANT ALL ON TABLE "public"."applications" TO "authenticated";
GRANT ALL ON TABLE "public"."applications" TO "service_role";



GRANT ALL ON TABLE "public"."bookmarks" TO "anon";
GRANT ALL ON TABLE "public"."bookmarks" TO "authenticated";
GRANT ALL ON TABLE "public"."bookmarks" TO "service_role";



GRANT ALL ON TABLE "public"."company_favorites" TO "anon";
GRANT ALL ON TABLE "public"."company_favorites" TO "authenticated";
GRANT ALL ON TABLE "public"."company_favorites" TO "service_role";



GRANT ALL ON TABLE "public"."company_info" TO "anon";
GRANT ALL ON TABLE "public"."company_info" TO "authenticated";
GRANT ALL ON TABLE "public"."company_info" TO "service_role";



GRANT ALL ON TABLE "public"."countries_and_cities" TO "anon";
GRANT ALL ON TABLE "public"."countries_and_cities" TO "authenticated";
GRANT ALL ON TABLE "public"."countries_and_cities" TO "service_role";



GRANT ALL ON TABLE "public"."feedbacks" TO "anon";
GRANT ALL ON TABLE "public"."feedbacks" TO "authenticated";
GRANT ALL ON TABLE "public"."feedbacks" TO "service_role";



GRANT ALL ON TABLE "public"."invitations" TO "anon";
GRANT ALL ON TABLE "public"."invitations" TO "authenticated";
GRANT ALL ON TABLE "public"."invitations" TO "service_role";



GRANT ALL ON TABLE "public"."job_feedback" TO "anon";
GRANT ALL ON TABLE "public"."job_feedback" TO "authenticated";
GRANT ALL ON TABLE "public"."job_feedback" TO "service_role";



GRANT ALL ON TABLE "public"."job_postings" TO "anon";
GRANT ALL ON TABLE "public"."job_postings" TO "authenticated";
GRANT ALL ON TABLE "public"."job_postings" TO "service_role";



GRANT ALL ON TABLE "public"."location_aliases" TO "anon";
GRANT ALL ON TABLE "public"."location_aliases" TO "authenticated";
GRANT ALL ON TABLE "public"."location_aliases" TO "service_role";



GRANT ALL ON TABLE "public"."payments" TO "anon";
GRANT ALL ON TABLE "public"."payments" TO "authenticated";
GRANT ALL ON TABLE "public"."payments" TO "service_role";



GRANT ALL ON TABLE "public"."price_plan" TO "anon";
GRANT ALL ON TABLE "public"."price_plan" TO "authenticated";
GRANT ALL ON TABLE "public"."price_plan" TO "service_role";



GRANT ALL ON TABLE "public"."resume_reviews" TO "anon";
GRANT ALL ON TABLE "public"."resume_reviews" TO "authenticated";
GRANT ALL ON TABLE "public"."resume_reviews" TO "service_role";



GRANT ALL ON TABLE "public"."resumes" TO "anon";
GRANT ALL ON TABLE "public"."resumes" TO "authenticated";
GRANT ALL ON TABLE "public"."resumes" TO "service_role";



GRANT ALL ON TABLE "public"."scraper_state" TO "anon";
GRANT ALL ON TABLE "public"."scraper_state" TO "authenticated";
GRANT ALL ON TABLE "public"."scraper_state" TO "service_role";



GRANT ALL ON TABLE "public"."user_api_tokens" TO "anon";
GRANT ALL ON TABLE "public"."user_api_tokens" TO "authenticated";
GRANT ALL ON TABLE "public"."user_api_tokens" TO "service_role";



GRANT ALL ON TABLE "public"."user_favorites" TO "anon";
GRANT ALL ON TABLE "public"."user_favorites" TO "authenticated";
GRANT ALL ON TABLE "public"."user_favorites" TO "service_role";



GRANT ALL ON TABLE "public"."user_favorites_companies" TO "anon";
GRANT ALL ON TABLE "public"."user_favorites_companies" TO "authenticated";
GRANT ALL ON TABLE "public"."user_favorites_companies" TO "service_role";



GRANT ALL ON TABLE "public"."user_info" TO "anon";
GRANT ALL ON TABLE "public"."user_info" TO "authenticated";
GRANT ALL ON TABLE "public"."user_info" TO "service_role";



GRANT ALL ON TABLE "public"."user_relevant_jobs" TO "anon";
GRANT ALL ON TABLE "public"."user_relevant_jobs" TO "authenticated";
GRANT ALL ON TABLE "public"."user_relevant_jobs" TO "service_role";



GRANT ALL ON TABLE "public"."waitlist" TO "anon";
GRANT ALL ON TABLE "public"."waitlist" TO "authenticated";
GRANT ALL ON TABLE "public"."waitlist" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "service_role";






























drop extension if exists "pg_net";

create extension if not exists "pg_net" with schema "public";


  create policy "Allow applicants to upload their own resume."
  on "storage"."objects"
  as permissive
  for insert
  to authenticated
with check (((bucket_id = 'applications'::text) AND ((storage.foldername(name))[4] = ( SELECT (auth.uid())::text AS uid))));



  create policy "Allow company to view applicant resumes"
  on "storage"."objects"
  as permissive
  for select
  to authenticated
using (((bucket_id = 'applications'::text) AND (EXISTS ( SELECT 1
   FROM public.company_info
  WHERE ((company_info.user_id = auth.uid()) AND ((company_info.id)::text = (storage.foldername(objects.name))[2]))))));



  create policy "Allow company user to upload user resume fhzllv_0"
  on "storage"."objects"
  as permissive
  for insert
  to authenticated
with check (((bucket_id = 'applications'::text) AND (EXISTS ( SELECT 1
   FROM public.company_info
  WHERE ((company_info.user_id = auth.uid()) AND ((company_info.id)::text = (storage.foldername(objects.name))[2]))))));



  create policy "Allow company users to access all resumes"
  on "storage"."objects"
  as permissive
  for select
  to authenticated
using (((bucket_id = 'resumes'::text) AND (EXISTS ( SELECT 1
   FROM public.company_info
  WHERE (company_info.user_id = auth.uid())))));



  create policy "Allow company users to access their folders 1ffg0oo_0"
  on "storage"."objects"
  as permissive
  for insert
  to authenticated
with check (((bucket_id = 'images'::text) AND (( SELECT (auth.uid())::text AS uid) = (storage.foldername(name))[2])));



  create policy "Allow company users to access their folders 1ffg0oo_1"
  on "storage"."objects"
  as permissive
  for select
  to authenticated
using (((bucket_id = 'images'::text) AND (( SELECT (auth.uid())::text AS uid) = (storage.foldername(name))[2])));



  create policy "Allow company users to access their folders 1ffg0oo_2"
  on "storage"."objects"
  as permissive
  for update
  to authenticated
using (((bucket_id = 'images'::text) AND (( SELECT (auth.uid())::text AS uid) = (storage.foldername(name))[2])));



  create policy "Allow company users to access their folders 1ffg0oo_3"
  on "storage"."objects"
  as permissive
  for delete
  to authenticated
using (((bucket_id = 'images'::text) AND (( SELECT (auth.uid())::text AS uid) = (storage.foldername(name))[2])));



  create policy "Give users access to own folder i5g8va_0"
  on "storage"."objects"
  as permissive
  for select
  to authenticated
using (((bucket_id = 'resumes'::text) AND (( SELECT (auth.uid())::text AS uid) = (storage.foldername(name))[2])));



  create policy "Give users access to own folder i5g8va_2"
  on "storage"."objects"
  as permissive
  for update
  to authenticated
using (((bucket_id = 'resumes'::text) AND (( SELECT (auth.uid())::text AS uid) = (storage.foldername(name))[2])));



  create policy "Give users access to own folder i5g8va_3"
  on "storage"."objects"
  as permissive
  for delete
  to authenticated
using (((bucket_id = 'resumes'::text) AND (( SELECT (auth.uid())::text AS uid) = (storage.foldername(name))[2])));



  create policy "auth user can insert in folder matching uuid i5g8va_0"
  on "storage"."objects"
  as permissive
  for insert
  to authenticated
with check (((bucket_id = 'resumes'::text) AND (( SELECT (auth.uid())::text AS uid) = (storage.foldername(name))[2])));



