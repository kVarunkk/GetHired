ALTER TABLE public.interviews
  ADD COLUMN IF NOT EXISTS charged_session_ids text[] NOT NULL DEFAULT ARRAY[]::text[];

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
  v_interview_credits CONSTANT integer := 10;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_session_id IS NULL OR btrim(p_session_id) = '' THEN
    RAISE EXCEPTION 'Voice session ID is required';
  END IF;

  SELECT i.charged_session_ids
    INTO v_charged_session_ids
    FROM public.interviews AS i
   WHERE i.id = p_interview_id
     AND i.user_id = auth.uid()
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Interview not found or access denied';
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

REVOKE ALL ON FUNCTION public.deduct_interview_session_credits(uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.deduct_interview_session_credits(uuid, text)
  TO authenticated;
