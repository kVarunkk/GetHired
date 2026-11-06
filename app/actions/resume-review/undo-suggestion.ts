"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { undoReviewSuggestion, type UndoSuggestionResult } from "@/helpers/resume-review/apply-suggestions";
import { createClient } from "@/lib/supabase/server";

const inputSchema = z
  .object({ reviewId: z.string().uuid(), bulletId: z.string().min(1), targetResumeId: z.string().uuid() })
  .strict();

/** SERVER ACTION: undoes one applied suggestion as the session user (RE-REQ-060). */
export async function undoReviewSuggestionAction(
  input: z.input<typeof inputSchema>,
): Promise<UndoSuggestionResult | { ok: false; code: "UNAUTHORIZED"; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, code: "UNAUTHORIZED", error: "Sign in first." };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "NOT_FOUND", error: "That suggestion isn't applied." };

  const result = await undoReviewSuggestion(supabase, user, parsed.data, { surface: "page" });
  if (result.ok) {
    revalidatePath("/resume");
    revalidatePath(`/resume/${result.targetResumeId}`);
  }
  return result;
}
