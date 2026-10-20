"use server";

import { z } from "zod";
import { getUserFromRequest } from "@/lib/supabase/get-user-from-request";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/utils/types/database.types";

const turnSchema = z.object({ turn_id: z.string().min(1).max(100) }).passthrough();

const inputSchema = z
  .object({
    interviewId: z.string().min(1).max(100),
    sessionId: z.string().min(1).max(100),
    turns: z.array(turnSchema).max(500),
  })
  .strict();

export type SavePracticeTurnsResult = { ok: true } | { ok: false; error: string };

/**
 * SERVER ACTION: saves the transcript of the session user's live practice
 * interview session. RLS only lets candidates update their practice
 * sessions (screening transcripts come from the voice server), and the
 * column grants limit the update to `turns` and `updated_at`.
 */
export async function savePracticeTurnsAction(
  input: z.input<typeof inputSchema>,
): Promise<SavePracticeTurnsResult> {
  const user = await getUserFromRequest();
  if (!user) return { ok: false, error: "Sign in first." };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid transcript." };
  const { interviewId, sessionId, turns } = parsed.data;

  const supabase = await createClient();
  const { data: updated, error } = await supabase
    .from("interview_sessions")
    .update({ turns: turns as Json, updated_at: new Date().toISOString() })
    .eq("id", sessionId)
    .eq("interview_id", interviewId)
    .select("id");
  if (error || !updated || updated.length === 0) return { ok: false, error: "Couldn't save the transcript." };

  return { ok: true };
}
