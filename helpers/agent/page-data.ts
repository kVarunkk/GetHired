import { SupabaseClient } from "@supabase/supabase-js";
import type { UIMessage } from "ai";
import { Database } from "@/utils/types/database.types";
import { loadSessionChat, sessionRoleFields } from "./persistence";
import type { AgentFeedbackState } from "./feedback";
import type { AgentRoleId } from "./roles/types";

type SessionSummary = { id: string; title: string; updated_at: string };

export type AgentChat = { messages: UIMessage[]; feedback: AgentFeedbackState };

const SESSION_COLUMNS = "id, title, updated_at";

const emptyChat = (): Promise<AgentChat> => Promise.resolve({ messages: [], feedback: {} });

const toSummary = ({ id, title, updated_at }: SessionSummary): SessionSummary => ({
  id,
  title,
  updated_at,
});

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
 * to open (`requestedId`, or the newest when none is asked for) and `chat`, its
 * messages with the user's feedback on them. Creates a first session for users
 * who have none.
 *
 * It returns once the sessions are known, so the page can show them while
 * `chat` is still loading. `chat` can reject: the caller must catch it. With a
 * `requestedId`, the messages load alongside the list, and are only handed back
 * once the list shows the session is the user's.
 *
 * Returns null when `requestedId` isn't one of the user's sessions (another
 * user's, deleted, or made up), so the page can 404 rather than show a
 * different chat under that URL.
 *
 * `newChat` (a prompt to start with) opens an empty chat instead of the
 * newest one: the newest if it is still empty, else a new session. Choosing
 * between them waits for the newest one's messages.
 */
export async function loadAgentPageData(
  supabase: SupabaseClient<Database>,
  userId: string,
  requestedId: string | undefined,
  { newChat = false, role }: { newChat?: boolean; role?: AgentRoleId } = {},
): Promise<{
  sessions: SessionSummary[];
  activeSessionId: string;
  chat: Promise<AgentChat>;
} | null> {
  let query = supabase
    .from("agent_sessions")
    .select(`${SESSION_COLUMNS}, role`)
    .eq("user_id", userId);
  if (role === "company") query = query.eq("role", role);
  const listing = Promise.resolve(query.order("updated_at", { ascending: false }));

  const loadChat = (sessionId: string): Promise<AgentChat> =>
    loadSessionChat(supabase, userId, sessionId, { withFeedback: true });
  const requestedChat = requestedId ? loadChat(requestedId) : undefined;
  // Dropped when the session isn't the user's, so its error isn't left unhandled.
  requestedChat?.catch(() => {});

  const { data, error } = await listing;
  if (error) throw error;

  const rows = data ?? [];
  const requested = requestedId ? rows.find((s) => s.id === requestedId) : undefined;
  if (requestedId && !requested) return null;

  if (rows.length === 0) {
    const created = await createSession(supabase, userId, role);
    return { sessions: [created], activeSessionId: created.id, chat: emptyChat() };
  }

  const sessions = rows.map(toSummary);
  const active = requested ?? rows[0];
  // A session of the other role isn't continued with this role's tools.
  const otherRole = Boolean(role && active.role && active.role !== role);
  const chat = otherRole ? emptyChat() : (requestedChat ?? loadChat(active.id));

  if (newChat && !requested && (await chat).messages.length > 0) {
    const created = await createSession(supabase, userId, role);
    return { sessions: [created, ...sessions], activeSessionId: created.id, chat: emptyChat() };
  }

  return { sessions, activeSessionId: active.id, chat };
}
