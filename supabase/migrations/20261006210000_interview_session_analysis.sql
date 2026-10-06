CREATE TABLE public.interview_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  interview_id uuid NOT NULL REFERENCES public.interviews(id) ON DELETE CASCADE,
  voice_session_id text NOT NULL,
  turns jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'completed', 'ineligible')),
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT interview_sessions_interview_voice_session_key
    UNIQUE (interview_id, voice_session_id)
);

CREATE INDEX interview_sessions_interview_started_idx
  ON public.interview_sessions (interview_id, started_at DESC);

CREATE TABLE public.interview_analyses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  interview_session_id uuid NOT NULL
    REFERENCES public.interview_sessions(id) ON DELETE CASCADE,
  perspective text NOT NULL DEFAULT 'candidate'
    CHECK (perspective IN ('candidate', 'company')),
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  result jsonb,
  error_code text,
  notification_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT interview_analyses_session_perspective_key
    UNIQUE (interview_session_id, perspective)
);

CREATE INDEX interview_analyses_status_created_idx
  ON public.interview_analyses (status, created_at);

ALTER TABLE public.interview_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interview_analyses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Candidates can read their interview sessions"
  ON public.interview_sessions FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.interviews i
      WHERE i.id = interview_sessions.interview_id
        AND i.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Candidates can create their interview sessions"
  ON public.interview_sessions FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.interviews i
      WHERE i.id = interview_sessions.interview_id
        AND i.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Candidates can update their interview session transcripts"
  ON public.interview_sessions FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.interviews i
      WHERE i.id = interview_sessions.interview_id
        AND i.user_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.interviews i
      WHERE i.id = interview_sessions.interview_id
        AND i.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Candidates can read their interview analyses"
  ON public.interview_analyses FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.interview_sessions s
      JOIN public.interviews i ON i.id = s.interview_id
      WHERE s.id = interview_analyses.interview_session_id
        AND i.user_id = (SELECT auth.uid())
    )
  );

GRANT SELECT ON public.interview_sessions TO authenticated;
GRANT INSERT (interview_id, voice_session_id, turns)
  ON public.interview_sessions TO authenticated;
GRANT UPDATE (turns, updated_at)
  ON public.interview_sessions TO authenticated;
GRANT SELECT ON public.interview_analyses TO authenticated;
GRANT ALL ON public.interview_sessions, public.interview_analyses TO service_role;

SELECT pgmq.create('interview_analysis_queue');

DO $$
DECLARE
  existing_job_id bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM vault.decrypted_secrets
    WHERE name = 'internal_secret'
  ) THEN
    RAISE EXCEPTION 'Internal secret not found in vault.';
  END IF;

  SELECT jobid
    INTO existing_job_id
    FROM cron.job
   WHERE jobname = 'interview-analysis-worker';

  IF existing_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(existing_job_id);
  END IF;

  PERFORM cron.schedule(
    'interview-analysis-worker',
    '* * * * *',
    $worker$
      SELECT net.http_get(
        url := 'https://gethired.devhub.co.in/api/updates/interview-analysis/worker',
        headers := jsonb_build_object(
          'X-Internal-Secret',
          (
            SELECT decrypted_secret
            FROM vault.decrypted_secrets
            WHERE name = 'internal_secret'
          )
        ),
        timeout_milliseconds := 300000
      );
    $worker$
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_interview_analysis_session(
  p_session_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_session public.interview_sessions%ROWTYPE;
  v_candidate_responses integer;
  v_interviewer_questions integer;
  v_analysis_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT s.*
    INTO v_session
    FROM public.interview_sessions s
    JOIN public.interviews i ON i.id = s.interview_id
   WHERE s.id = p_session_id
     AND i.user_id = auth.uid()
   FOR UPDATE OF s;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Interview session not found or access denied';
  END IF;

  IF v_session.status <> 'active' THEN
    SELECT a.id INTO v_analysis_id
      FROM public.interview_analyses a
     WHERE a.interview_session_id = v_session.id
       AND a.perspective = 'candidate';

    RETURN jsonb_build_object(
      'session_id', v_session.id,
      'status', v_session.status,
      'analysis_id', v_analysis_id
    );
  END IF;

  SELECT
    count(*) FILTER (
      WHERE nullif(btrim(turn->>'user'), '') IS NOT NULL
    ),
    count(*) FILTER (
      WHERE nullif(btrim(turn->>'assistant'), '') IS NOT NULL
    )
    INTO v_candidate_responses, v_interviewer_questions
    FROM jsonb_array_elements(
      CASE
        WHEN jsonb_typeof(v_session.turns) = 'array' THEN v_session.turns
        ELSE '[]'::jsonb
      END
    ) AS turn;

  UPDATE public.interview_sessions
     SET status = CASE
                    WHEN v_candidate_responses >= 3
                     AND v_interviewer_questions >= 3 THEN 'completed'
                    ELSE 'ineligible'
                  END,
         ended_at = now(),
         updated_at = now()
   WHERE id = v_session.id
   RETURNING * INTO v_session;

  IF v_session.status = 'completed' THEN
    INSERT INTO public.interview_analyses (
      interview_session_id,
      perspective,
      status
    )
    VALUES (v_session.id, 'candidate', 'queued')
    ON CONFLICT (interview_session_id, perspective) DO NOTHING
    RETURNING id INTO v_analysis_id;

    IF v_analysis_id IS NOT NULL THEN
      PERFORM pgmq.send(
        'interview_analysis_queue',
        jsonb_build_object('analysisId', v_analysis_id)
      );
    ELSE
      SELECT a.id INTO v_analysis_id
        FROM public.interview_analyses a
       WHERE a.interview_session_id = v_session.id
         AND a.perspective = 'candidate';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'session_id', v_session.id,
    'status', v_session.status,
    'analysis_id', v_analysis_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_interview_analysis_session(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finalize_interview_analysis_session(uuid)
  TO authenticated;

INSERT INTO public.interview_sessions (
  interview_id,
  voice_session_id,
  turns,
  status,
  ended_at,
  started_at,
  created_at,
  updated_at
)
SELECT
  i.id,
  'legacy:' || i.id::text,
  i.turns::jsonb,
  CASE
    WHEN (
      SELECT count(*)
      FROM jsonb_array_elements(i.turns::jsonb) AS turn
      WHERE nullif(btrim(turn->>'user'), '') IS NOT NULL
    ) >= 3
    AND (
      SELECT count(*)
      FROM jsonb_array_elements(i.turns::jsonb) AS turn
      WHERE nullif(btrim(turn->>'assistant'), '') IS NOT NULL
    ) >= 3 THEN 'completed'
    ELSE 'ineligible'
  END,
  COALESCE(i.updated_at, i.created_at, now()),
  COALESCE(i.created_at, now()),
  COALESCE(i.created_at, now()),
  COALESCE(i.updated_at, i.created_at, now())
FROM public.interviews i
WHERE jsonb_typeof(i.turns::jsonb) = 'array'
  AND jsonb_array_length(i.turns::jsonb) > 0
ON CONFLICT (interview_id, voice_session_id) DO NOTHING;

WITH eligible_legacy AS (
  SELECT s.id
  FROM public.interview_sessions s
  WHERE s.voice_session_id = 'legacy:' || s.interview_id::text
    AND (
      SELECT count(*) FILTER (WHERE nullif(btrim(turn->>'user'), '') IS NOT NULL)
      FROM jsonb_array_elements(s.turns) AS turn
    ) >= 3
    AND (
      SELECT count(*) FILTER (
        WHERE nullif(btrim(turn->>'assistant'), '') IS NOT NULL
      )
      FROM jsonb_array_elements(s.turns) AS turn
    ) >= 3
),
queued_legacy AS (
  INSERT INTO public.interview_analyses (
    interview_session_id,
    perspective,
    status
  )
  SELECT id, 'candidate', 'queued'
  FROM eligible_legacy
  ON CONFLICT (interview_session_id, perspective) DO NOTHING
  RETURNING id
)
SELECT pgmq.send(
  'interview_analysis_queue',
  jsonb_build_object('analysisId', id)
)
FROM queued_legacy;
