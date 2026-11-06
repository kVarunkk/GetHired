"use server";

import { revalidatePath } from "next/cache";
import {
  applyReviewSuggestions,
  type ApplySuggestionsInput,
  type ApplySuggestionsResult,
} from "@/helpers/resume-review/apply-suggestions";
import { createClient } from "@/lib/supabase/server";

/** SERVER ACTION: applies a review's suggestions as the session user (RE-REQ-056). */
export async function applyReviewSuggestionsAction(
  input: ApplySuggestionsInput,
): Promise<ApplySuggestionsResult | { ok: false; code: "UNAUTHORIZED"; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, code: "UNAUTHORIZED", error: "Sign in first." };

  const result = await applyReviewSuggestions(supabase, user, input, { surface: "page" });
  if (result.ok && result.targetResumeId) {
    revalidatePath("/resume");
    revalidatePath(`/resume/${result.targetResumeId}`);
  }
  return result;
}
