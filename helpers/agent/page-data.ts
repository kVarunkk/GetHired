import { SupabaseClient } from "@supabase/supabase-js";
import type { UIMessage } from "ai";
import { Database } from "@/utils/types/database.types";
import { loadSession } from "./persistence";

type SessionSummary = { id: string; title: string; updated_at: string };

const SESSION_COLUMNS = "id, title, updated_at";

/**
 * Data for the /agent page: the user's sessions (newest first), the session
 * to open (`requestedId` if it is theirs, otherwise the newest) and its
 * messages. Creates a first session for users who have none.
 */
export async function loadAgentPageData(
  supabase: SupabaseClient<Database>,
  userId: string,
  requestedId: string | undefined,
): Promise<{ sessions: SessionSummary[]; activeSessionId: string; messages: UIMessage[] }> {
  const { data, error } = await supabase
    .from("agent_sessions")
    .select(SESSION_COLUMNS)
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });
  if (error) throw error;

  let sessions = data ?? [];
  if (sessions.length === 0) {
    const { data: created, error: createError } = await supabase
      .from("agent_sessions")
      .insert({ user_id: userId })
      .select(SESSION_COLUMNS)
      .single();
    if (createError) throw createError;
    sessions = [created];
  }

  const active = sessions.find((s) => s.id === requestedId) ?? sessions[0];
  const loaded = await loadSession(supabase, userId, active.id);

  return { sessions, activeSessionId: active.id, messages: loaded?.messages ?? [] };
}
