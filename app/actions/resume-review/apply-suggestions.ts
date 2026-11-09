"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  applyReviewSuggestions,
  type ApplySuggestionsInput,
  type ApplySuggestionsResult,
} from "@/helpers/resume-review/apply-suggestions";
import { createClient } from "@/lib/supabase/server";

/** Where the click came from, for the save's record. It grants nothing (RI-REQ-033). */
const surfaceSchema = z.enum(["page", "agent"]);

/** SERVER ACTION: applies a review's changes as the session user (RE-REQ-056). */
export async function applyReviewSuggestionsAction(
  input: ApplySuggestionsInput,
  surface: z.input<typeof surfaceSchema> = "page",
): Promise<ApplySuggestionsResult | { ok: false; code: "UNAUTHORIZED"; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, code: "UNAUTHORIZED", error: "Sign in first." };

  const parsedSurface = surfaceSchema.safeParse(surface);
  if (!parsedSurface.success) return { ok: false, code: "INVALID", error: "Choose a suggestion to apply." };

  const result = await applyReviewSuggestions(supabase, user, input, { surface: parsedSurface.data });
  if (result.ok && result.targetResumeId) {
    revalidatePath("/resume");
    revalidatePath(`/resume/${result.targetResumeId}`);
  }
  return result;
}
