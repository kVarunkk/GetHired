"use server";

import { after } from "next/server";
import { getToolName, isToolUIPart, type UIMessage } from "ai";
import { z } from "zod";
import { getUserFromRequest } from "@/lib/supabase/get-user-from-request";
import { createClient } from "@/lib/supabase/server";
import {
  agentFeedbackInputSchema,
  FEEDBACK_MESSAGE_ID_MAX,
  hasFeedbackPart,
  type AgentFeedbackInput,
} from "@/helpers/agent/feedback";
import type { AgentRoleId } from "@/helpers/agent/roles/types";
import { eventCaptureServer } from "@/helpers/posthog/EventCaptureServer";
import { reportError } from "@/helpers/posthog/report-error";
import { PostHogEvent } from "@/utils/types";
import type { Json } from "@/utils/types/database.types";

export type AgentFeedbackResult = { ok: true } | { ok: false; error: string };

const SIGN_IN = "Sign in to send feedback.";
const INVALID = "That feedback couldn't be saved.";
const GONE = "That reply is no longer in this chat.";
const FAILED = "Couldn't save your feedback. Please try again.";

const removeSchema = z
  .object({
    sessionId: z.string().uuid(),
    messageId: z.string().min(1).max(FEEDBACK_MESSAGE_ID_MAX),
  })
  .strict();

type MessagePart = UIMessage["parts"][number];
type StoredMessage = { role: string; parts: Json; metadata: Json | null; seq: number };

/** The user and agent role from the session, never from input (AF-SEC-001). */
async function sessionUser() {
  const user = await getUserFromRequest();
  const type = user?.app_metadata?.type;
  if (!user || (type !== "applicant" && type !== "company")) return null;
  return { user, role: type as AgentRoleId };
}

/**
 * What's kept with the feedback (AF-DATA-002): where the reply sat, which
 * tools it used, whether it was stopped and how long it was. Built from the
 * stored row, never from input, and never with the reply text.
 */
function feedbackContext(message: StoredMessage) {
  const parts = (Array.isArray(message.parts) ? message.parts : []) as unknown as MessagePart[];
  const tools = [...new Set(parts.filter(isToolUIPart).map((part) => getToolName(part)))];
  const chars = parts.reduce((sum, part) => sum + (part.type === "text" ? part.text.length : 0), 0);
  const metadata = message.metadata && typeof message.metadata === "object" ? message.metadata : {};
  return {
    seq: message.seq,
    tools,
    stopped: (metadata as Record<string, unknown>).stopped === true,
    chars,
  };
}

/** The user's assistant message in that session, under RLS; null when it's gone. */
async function loadReply(
  supabase: Awaited<ReturnType<typeof createClient>>,
  sessionId: string,
  messageId: string,
) {
  const { data, error } = await supabase
    .from("agent_messages")
    .select("role, parts, metadata, seq")
    .eq("id", messageId)
    .eq("session_id", sessionId)
    .maybeSingle();
  if (error) throw error;
  return data as StoredMessage | null;
}

function capture(
  userId: string,
  properties: {
    role: AgentRoleId;
    kind: AgentFeedbackInput["kind"];
    rating: number | null;
    dismissed: boolean;
    reasons: string[];
    has_comment: boolean;
    session_id: string;
    message_id: string;
    tools: string[];
    action: "set" | "remove";
  },
) {
  // The comment text stays in the table (AF-REQ-040).
  after(() => eventCaptureServer({ event: PostHogEvent.AgentFeedback, distinctId: userId, properties }));
}

/**
 * SERVER ACTION: saves 👍/👎 on a reply, or the survey card's answer or
 * dismissal (AF-REQ-030). One row per user, message and kind, so a second
 * call updates the first. No credits are used.
 */
export async function submitAgentFeedbackAction(input: unknown): Promise<AgentFeedbackResult> {
  const session = await sessionUser();
  if (!session) return { ok: false, error: SIGN_IN };
  const { user, role } = session;

  const parsed = agentFeedbackInputSchema(role).safeParse(input);
  if (!parsed.success) return { ok: false, error: INVALID };
  const { sessionId, messageId, kind, rating, reasons = [], comment } = parsed.data;
  const dismissed = parsed.data.dismissed === true;

  try {
    const supabase = await createClient();
    const message = await loadReply(supabase, sessionId, messageId);
    if (!message) return { ok: false, error: GONE };
    if (message.role !== "assistant") return { ok: false, error: INVALID };
    // A survey only answers a card the server added (AF-SEC-001).
    if (kind === "survey" && !hasFeedbackPart((message.parts ?? []) as { type: string }[])) {
      return { ok: false, error: INVALID };
    }

    const context = feedbackContext(message);
    const { error } = await supabase.from("agent_feedback").upsert(
      {
        user_id: user.id,
        session_id: sessionId,
        message_id: messageId,
        agent_role: role,
        kind,
        rating: rating ?? null,
        dismissed,
        reasons,
        comment: comment ?? null,
        context,
      },
      { onConflict: "user_id,message_id,kind" },
    );
    if (error) throw error;

    capture(user.id, {
      role,
      kind,
      rating: rating ?? null,
      dismissed,
      reasons,
      has_comment: comment !== undefined,
      session_id: sessionId,
      message_id: messageId,
      tools: context.tools,
      action: "set",
    });
    return { ok: true };
  } catch (error) {
    reportError("[agent] feedback save failed", error);
    return { ok: false, error: FAILED };
  }
}

/** SERVER ACTION: removes the user's 👍/👎 on a reply (AF-REQ-003, AF-REQ-030). */
export async function removeAgentFeedbackAction(input: unknown): Promise<AgentFeedbackResult> {
  const session = await sessionUser();
  if (!session) return { ok: false, error: SIGN_IN };
  const { user, role } = session;

  const parsed = removeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: INVALID };
  const { sessionId, messageId } = parsed.data;

  try {
    const supabase = await createClient();
    const message = await loadReply(supabase, sessionId, messageId);
    if (!message) return { ok: false, error: GONE };
    if (message.role !== "assistant") return { ok: false, error: INVALID };

    const { error } = await supabase
      .from("agent_feedback")
      .delete()
      .eq("user_id", user.id)
      .eq("session_id", sessionId)
      .eq("message_id", messageId)
      .eq("kind", "reply");
    if (error) throw error;

    capture(user.id, {
      role,
      kind: "reply",
      rating: null,
      dismissed: false,
      reasons: [],
      has_comment: false,
      session_id: sessionId,
      message_id: messageId,
      tools: feedbackContext(message).tools,
      action: "remove",
    });
    return { ok: true };
  } catch (error) {
    reportError("[agent] feedback remove failed", error);
    return { ok: false, error: FAILED };
  }
}
