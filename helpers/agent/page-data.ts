import { SupabaseClient } from "@supabase/supabase-js";
import type { UIMessage } from "ai";
import { Database } from "@/utils/types/database.types";
import { loadSession } from "./persistence";

type SessionSummary = { id: string; title: string; updated_at: string };

const SESSION_COLUMNS = "id, title, updated_at";

async function createSession(supabase: SupabaseClient<Database>, userId: string) {
  const { data, error } = await supabase
    .from("agent_sessions")
    .insert({ user_id: userId })
    .select(SESSION_COLUMNS)
    .single();
  if (error) throw error;
  return data;
}

/**
 * Data for the /agent page: the user's sessions (newest first), the session
 * to open (`requestedId` if it is theirs, otherwise the newest) and its
 * messages. Creates a first session for users who have none.
 *
 * `newChat` (a prompt to start with) opens an empty chat instead of the
 * newest one: the newest if it is still empty, else a new session.
 */
export async function loadAgentPageData(
  supabase: SupabaseClient<Database>,
  userId: string,
  requestedId: string | undefined,
  { newChat = false }: { newChat?: boolean } = {},
): Promise<{ sessions: SessionSummary[]; activeSessionId: string; messages: UIMessage[] }> {
  const { data, error } = await supabase
    .from("agent_sessions")
    .select(SESSION_COLUMNS)
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });
  if (error) throw error;

  let sessions = data ?? [];
  if (sessions.length === 0) sessions = [await createSession(supabase, userId)];

  const requested = sessions.find((s) => s.id === requestedId);
  const active = requested ?? sessions[0];
  const messages = (await loadSession(supabase, userId, active.id))?.messages ?? [];

  if (newChat && !requested && messages.length > 0) {
    const created = await createSession(supabase, userId);
    return { sessions: [created, ...sessions], activeSessionId: created.id, messages: [] };
  }

  return { sessions, activeSessionId: active.id, messages };
}
