-- Practice interview sessions now cost 5 AI credits (was 10). Keep in step with TAICredits.AI_INTERVIEW.
CREATE OR REPLACE FUNCTION public.deduct_interview_session_credits(
  p_interview_id uuid,
  p_session_id text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_charged_session_ids text[];
  v_active_session_id text;
  v_session_updated_at timestamptz;
  v_interview_credits CONSTANT integer := 5;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_session_id IS NULL OR btrim(p_session_id) = '' THEN
    RAISE EXCEPTION 'Voice session ID is required';
  END IF;

  SELECT
    i.charged_session_ids,
    i.active_session_id,
    i.active_session_updated_at
    INTO v_charged_session_ids, v_active_session_id, v_session_updated_at
    FROM public.interviews AS i
   WHERE i.id = p_interview_id
     AND i.user_id = auth.uid()
     AND i.kind = 'practice'
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Interview not found or access denied';
  END IF;

  IF v_active_session_id IS DISTINCT FROM p_session_id
     OR v_session_updated_at IS NULL
     OR v_session_updated_at <= NOW() - INTERVAL '90 seconds' THEN
    RAISE EXCEPTION 'Interview session is not active';
  END IF;

  IF p_session_id = ANY(COALESCE(v_charged_session_ids, ARRAY[]::text[])) THEN
    RETURN 'already_charged';
  END IF;

  UPDATE public.user_info
     SET ai_credits = ai_credits - v_interview_credits,
         updated_at = NOW()
   WHERE user_id = auth.uid()
     AND ai_credits >= v_interview_credits;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Insufficient AI credits';
  END IF;

  UPDATE public.interviews
     SET charged_session_ids = array_append(
       COALESCE(v_charged_session_ids, ARRAY[]::text[]),
       p_session_id
     )
   WHERE id = p_interview_id
     AND user_id = auth.uid();

  RETURN 'charged';
END;
$$;
