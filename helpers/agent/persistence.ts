import { SupabaseClient } from "@supabase/supabase-js";
import type { UIMessage } from "ai";
import { Database, Json, Tables } from "@/utils/types/database.types";
import type { AgentProfileSummary } from "./system-prompt";

type Client = SupabaseClient<Database>;

export type AgentSession = Tables<"agent_sessions">;

/**
 * The user's session and its messages ordered by `seq`, or null when the
 * session doesn't exist or belongs to someone else. Database errors are thrown.
 */
export async function loadSession(
  supabase: Client,
  userId: string,
  sessionId: string,
): Promise<{ session: AgentSession; messages: UIMessage[] } | null> {
  const { data: session, error: sessionError } = await supabase
    .from("agent_sessions")
    .select("*")
    .eq("id", sessionId)
    .eq("user_id", userId)
    .maybeSingle();

  if (sessionError) throw sessionError;
  if (!session) return null;

  const { data: rows, error } = await supabase
    .from("agent_messages")
    .select("id, role, parts, metadata")
    .eq("session_id", sessionId)
    .order("seq", { ascending: true });

  if (error) throw error;

  const messages = (rows ?? []).map(
    ({ id, role, parts, metadata }) =>
      ({
        id,
        role,
        parts,
        ...(metadata == null ? {} : { metadata }),
      }) as UIMessage,
  );

  return { session, messages };
}

/**
 * Deletes the session's messages after `messageId` (regenerate), or from it
 * onwards when `inclusive` (editing a user message) (REQ-005). An unknown
 * message id is a no-op.
 */
export async function truncateAfter(
  supabase: Client,
  sessionId: string,
  messageId: string,
  { inclusive }: { inclusive: boolean },
) {
  const { data: anchor, error: lookupError } = await supabase
    .from("agent_messages")
    .select("seq")
    .eq("id", messageId)
    .eq("session_id", sessionId)
    .maybeSingle();

  if (lookupError) throw lookupError;
  if (!anchor) return;

  const query = supabase.from("agent_messages").delete().eq("session_id", sessionId);
  const { error } = inclusive
    ? await query.gte("seq", anchor.seq)
    : await query.gt("seq", anchor.seq);

  if (error) throw error;
}

/**
 * Saves messages by upserting on `id`, so a message changed after it was
 * first stored (tool approval or output) updates its row and keeps its `seq`
 * (REQ-006).
 */
export async function upsertMessages(
  supabase: Client,
  sessionId: string,
  userId: string,
  messages: UIMessage[],
) {
  const rows = messages.map((message) => ({
    id: message.id,
    session_id: sessionId,
    user_id: userId,
    role: message.role,
    parts: message.parts as unknown as Json,
    metadata: (message.metadata ?? null) as Json,
  }));

  if (rows.length === 0) return;

  const { error } = await supabase
    .from("agent_messages")
    .upsert(rows, { onConflict: "id" });

  if (error) throw error;
}

/** Marks the session as active so it sorts first in the session list. */
export async function touchSession(
  supabase: Client,
  userId: string,
  sessionId: string,
  now: Date,
) {
  const { error } = await supabase
    .from("agent_sessions")
    .update({ updated_at: now.toISOString() })
    .eq("id", sessionId)
    .eq("user_id", userId);

  if (error) throw error;
}

export async function setSessionTitle(
  supabase: Client,
  userId: string,
  sessionId: string,
  title: string,
) {
  const { error } = await supabase
    .from("agent_sessions")
    .update({ title })
    .eq("id", sessionId)
    .eq("user_id", userId);

  if (error) throw error;
}

const PROMPT_PROFILE_COLUMNS =
  "full_name, ai_credits, desired_roles, preferred_locations, min_salary, max_salary, salary_currency, experience_years, top_skills, job_type, visa_sponsorship_required, work_style_preferences, career_goals_short_term, career_goals_long_term, company_size_preference, filled";

/** The profile fields shown to the agent in its system prompt, or null. */
export async function loadPromptProfile(
  supabase: Client,
  userId: string,
): Promise<AgentProfileSummary | null> {
  const { data, error } = await supabase
    .from("user_info")
    .select(PROMPT_PROFILE_COLUMNS)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/** The user's messages since UTC midnight, across all sessions (REQ-018). */
export async function countUserMessagesToday(
  supabase: Client,
  userId: string,
  now: Date,
): Promise<number> {
  const startOfDay = new Date(now);
  startOfDay.setUTCHours(0, 0, 0, 0);

  const { count, error } = await supabase
    .from("agent_messages")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("role", "user")
    .gte("created_at", startOfDay.toISOString());

  if (error) throw error;
  return count ?? 0;
}
