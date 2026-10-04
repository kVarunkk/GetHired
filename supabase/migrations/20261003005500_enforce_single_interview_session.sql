ALTER TABLE public.interviews
  ADD COLUMN IF NOT EXISTS active_session_id text,
  ADD COLUMN IF NOT EXISTS active_session_updated_at timestamptz;

CREATE OR REPLACE FUNCTION public.reserve_interview_session(
  p_interview_id uuid,
  p_reservation_id text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_active_session_id text;
  v_updated_at timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_reservation_id IS NULL OR btrim(p_reservation_id) = '' THEN
    RAISE EXCEPTION 'Reservation ID is required';
  END IF;

  SELECT i.active_session_id, i.active_session_updated_at
    INTO v_active_session_id, v_updated_at
    FROM public.interviews AS i
   WHERE i.id = p_interview_id
     AND i.user_id = auth.uid()
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Interview not found or access denied';
  END IF;

  IF v_active_session_id IS NOT NULL
     AND v_updated_at IS NOT NULL
     AND v_updated_at > NOW() - INTERVAL '90 seconds' THEN
    RETURN 'already_active';
  END IF;

  UPDATE public.interviews
     SET active_session_id = p_reservation_id,
         active_session_updated_at = NOW()
   WHERE id = p_interview_id
     AND user_id = auth.uid();

  RETURN 'reserved';
END;
$$;

CREATE OR REPLACE FUNCTION public.activate_interview_session(
  p_interview_id uuid,
  p_reservation_id text,
  p_session_id text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_session_id IS NULL OR btrim(p_session_id) = '' THEN
    RAISE EXCEPTION 'Voice session ID is required';
  END IF;

  UPDATE public.interviews
     SET active_session_id = p_session_id,
         active_session_updated_at = NOW()
   WHERE id = p_interview_id
     AND user_id = auth.uid()
     AND active_session_id = p_reservation_id
     AND active_session_updated_at > NOW() - INTERVAL '90 seconds';

  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.heartbeat_interview_session(
  p_interview_id uuid,
  p_session_id text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  UPDATE public.interviews
     SET active_session_updated_at = NOW()
   WHERE id = p_interview_id
     AND user_id = auth.uid()
     AND active_session_id = p_session_id
     AND active_session_updated_at > NOW() - INTERVAL '90 seconds';

  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_interview_session(
  p_interview_id uuid,
  p_session_id text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  UPDATE public.interviews
     SET active_session_id = NULL,
         active_session_updated_at = NULL
   WHERE id = p_interview_id
     AND user_id = auth.uid()
     AND active_session_id = p_session_id;

  RETURN FOUND;
END;
$$;

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
  v_interview_credits CONSTANT integer := 10;
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

REVOKE ALL ON FUNCTION public.reserve_interview_session(uuid, text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.activate_interview_session(uuid, text, text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.heartbeat_interview_session(uuid, text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.release_interview_session(uuid, text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.deduct_interview_session_credits(uuid, text)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.reserve_interview_session(uuid, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.activate_interview_session(uuid, text, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.heartbeat_interview_session(uuid, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_interview_session(uuid, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.deduct_interview_session_credits(uuid, text)
  TO authenticated;
