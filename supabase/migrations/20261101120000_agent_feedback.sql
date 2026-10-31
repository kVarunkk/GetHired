-- Agent feedback: 👍/👎 on replies and the occasional in-chat survey card.
-- See plan/agent-feedback/feature-agent-feedback-spec.md §3 (AF-DATA-001).

CREATE TABLE public.agent_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES public.agent_sessions(id) ON DELETE CASCADE,
  -- No FK: regenerating or editing deletes later messages, and feedback on a
  -- reply the user then regenerated is the most useful kind.
  message_id text NOT NULL,
  agent_role text NOT NULL CHECK (agent_role IN ('applicant', 'company')),
  kind text NOT NULL CHECK (kind IN ('reply', 'survey')),
  -- reply: -1 | 1; survey: 1..5, or null when dismissed.
  rating smallint,
  dismissed boolean NOT NULL DEFAULT false,
  reasons text[] NOT NULL DEFAULT '{}',
  comment text CHECK (char_length(comment) <= 2000),
  -- Copied from the stored message by the server action (AF-DATA-002), so it
  -- survives a regenerate. Never holds the reply text.
  context jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, message_id, kind),
  CHECK (
    (kind = 'reply' AND dismissed = false AND rating IN (-1, 1)) OR
    (kind = 'survey' AND ((dismissed AND rating IS NULL) OR (NOT dismissed AND rating BETWEEN 1 AND 5)))
  )
);

CREATE INDEX agent_feedback_session_idx ON public.agent_feedback (session_id);
CREATE INDEX agent_feedback_created_idx ON public.agent_feedback (created_at DESC);
-- The dismissed-survey cooldown (AF-DEC-003).
CREATE INDEX agent_feedback_user_dismissed_idx
  ON public.agent_feedback (user_id, created_at DESC)
  WHERE kind = 'survey' AND dismissed;

ALTER TABLE public.agent_sessions ADD COLUMN feedback_requested_at timestamptz;
CREATE INDEX agent_sessions_user_feedback_idx
  ON public.agent_sessions (user_id, feedback_requested_at DESC)
  WHERE feedback_requested_at IS NOT NULL;

-- Keeps updated_at current and the row's identity fixed.
CREATE OR REPLACE FUNCTION public.agent_feedback_before_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.session_id IS DISTINCT FROM OLD.session_id
     OR NEW.message_id IS DISTINCT FROM OLD.message_id
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.agent_role IS DISTINCT FROM OLD.agent_role THEN
    RAISE EXCEPTION 'agent_feedback: user_id, session_id, message_id, kind and agent_role cannot change';
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER agent_feedback_before_update
  BEFORE UPDATE ON public.agent_feedback
  FOR EACH ROW EXECUTE FUNCTION public.agent_feedback_before_update();

-- Row Level Security: owner-only, and writes must target the user's own session.
ALTER TABLE public.agent_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agent_feedback_select_own" ON public.agent_feedback
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY "agent_feedback_insert_own" ON public.agent_feedback
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.agent_sessions s
      WHERE s.id = session_id AND s.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "agent_feedback_update_own" ON public.agent_feedback
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.agent_sessions s
      WHERE s.id = session_id AND s.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "agent_feedback_delete_own" ON public.agent_feedback
  FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));
