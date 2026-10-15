import { SupabaseClient } from "@supabase/supabase-js";
import type { UIMessage } from "ai";
import { Database } from "@/utils/types/database.types";
import { loadSession, sessionRoleFields } from "./persistence";
import type { AgentRoleId } from "./roles/types";

type SessionSummary = { id: string; title: string; updated_at: string };

const SESSION_COLUMNS = "id, title, updated_at";

async function createSession(
  supabase: SupabaseClient<Database>,
  userId: string,
  role: AgentRoleId | undefined,
) {
  const { data, error } = await supabase
    .from("agent_sessions")
    .insert({ user_id: userId, ...sessionRoleFields(role) })
    .select(SESSION_COLUMNS)
    .single();
  if (error) throw error;
  return data;
}

/**
 * Data for the /agent page: the user's sessions (newest first), the session
 * to open (`requestedId`, or the newest when none is asked for) and its
 * messages. Creates a first session for users who have none.
 *
 * Returns null when `requestedId` isn't one of the user's sessions (another
 * user's, deleted, or made up), so the page can 404 rather than show a
 * different chat under that URL.
 *
 * `newChat` (a prompt to start with) opens an empty chat instead of the
 * newest one: the newest if it is still empty, else a new session.
 */
export async function loadAgentPageData(
  supabase: SupabaseClient<Database>,
  userId: string,
  requestedId: string | undefined,
  { newChat = false, role }: { newChat?: boolean; role?: AgentRoleId } = {},
): Promise<{ sessions: SessionSummary[]; activeSessionId: string; messages: UIMessage[] } | null> {
  let query = supabase.from("agent_sessions").select(SESSION_COLUMNS).eq("user_id", userId);
  if (role === "company") query = query.eq("role", role);
  const { data, error } = await query.order("updated_at", { ascending: false });
  if (error) throw error;

  let sessions = data ?? [];
  const requested = requestedId ? sessions.find((s) => s.id === requestedId) : undefined;
  if (requestedId && !requested) return null;

  if (sessions.length === 0) sessions = [await createSession(supabase, userId, role)];
  const active = requested ?? sessions[0];
  const messages = (await loadSession(supabase, userId, active.id, { role }))?.messages ?? [];

  if (newChat && !requested && messages.length > 0) {
    const created = await createSession(supabase, userId, role);
    return { sessions: [created, ...sessions], activeSessionId: created.id, messages: [] };
  }

  return { sessions, activeSessionId: active.id, messages };
}
