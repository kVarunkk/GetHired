-- /agent feature: chat sessions, persisted UI messages, and long-term user memories.
-- See plan/feature-agent-spec.md §3.

CREATE TABLE public.agent_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'New chat'
    CHECK (char_length(title) BETWEEN 1 AND 80),
  summary text,
  summary_upto_message_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX agent_sessions_user_updated_idx
  ON public.agent_sessions (user_id, updated_at DESC);

CREATE TABLE public.agent_messages (
  -- AI SDK UIMessage.id
  id text PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES public.agent_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  parts jsonb NOT NULL,
  metadata jsonb,
  -- Stable ordering independent of clock skew; "messages after X" means seq > X.seq.
  seq bigint GENERATED ALWAYS AS IDENTITY,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX agent_messages_session_seq_idx
  ON public.agent_messages (session_id, seq);

-- Daily message cap: count of a user's own messages per day.
CREATE INDEX agent_messages_user_created_idx
  ON public.agent_messages (user_id, created_at)
  WHERE role = 'user';

CREATE TABLE public.agent_memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 300),
  category text NOT NULL
    CHECK (category IN ('preference', 'goal', 'constraint', 'fact')),
  source_session_id uuid REFERENCES public.agent_sessions(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX agent_memories_user_updated_idx
  ON public.agent_memories (user_id, updated_at DESC);

-- Keep updated_at current on every update.
CREATE OR REPLACE FUNCTION public.agent_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER agent_sessions_set_updated_at
  BEFORE UPDATE ON public.agent_sessions
  FOR EACH ROW EXECUTE FUNCTION public.agent_set_updated_at();

CREATE TRIGGER agent_memories_set_updated_at
  BEFORE UPDATE ON public.agent_memories
  FOR EACH ROW EXECUTE FUNCTION public.agent_set_updated_at();

-- Row Level Security
ALTER TABLE public.agent_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_memories ENABLE ROW LEVEL SECURITY;

-- agent_sessions: owner-only
CREATE POLICY "agent_sessions_select_own" ON public.agent_sessions
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY "agent_sessions_insert_own" ON public.agent_sessions
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "agent_sessions_update_own" ON public.agent_sessions
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "agent_sessions_delete_own" ON public.agent_sessions
  FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- agent_messages: owner-only, and writes must target a session the user owns
CREATE POLICY "agent_messages_select_own" ON public.agent_messages
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY "agent_messages_insert_own" ON public.agent_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.agent_sessions s
      WHERE s.id = session_id AND s.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "agent_messages_update_own" ON public.agent_messages
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.agent_sessions s
      WHERE s.id = session_id AND s.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "agent_messages_delete_own" ON public.agent_messages
  FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- agent_memories: owner-only; source_session_id (if set) must be the user's own session
CREATE POLICY "agent_memories_select_own" ON public.agent_memories
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY "agent_memories_insert_own" ON public.agent_memories
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND (
      source_session_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.agent_sessions s
        WHERE s.id = source_session_id AND s.user_id = (SELECT auth.uid())
      )
    )
  );

CREATE POLICY "agent_memories_update_own" ON public.agent_memories
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND (
      source_session_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.agent_sessions s
        WHERE s.id = source_session_id AND s.user_id = (SELECT auth.uid())
      )
    )
  );

CREATE POLICY "agent_memories_delete_own" ON public.agent_memories
  FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- Privileges: no anon access; authenticated is further limited by RLS above.
REVOKE ALL ON public.agent_sessions, public.agent_messages, public.agent_memories
  FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.agent_sessions, public.agent_messages, public.agent_memories
  TO authenticated;
GRANT ALL ON public.agent_sessions, public.agent_messages, public.agent_memories
  TO service_role;
