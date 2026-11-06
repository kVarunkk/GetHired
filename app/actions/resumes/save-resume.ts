"use server";

import { revalidatePath } from "next/cache";
import { saveResume, type SaveResumeInput, type SaveResumeResult } from "@/helpers/resumes/save-resume";
import { createClient } from "@/lib/supabase/server";

/** SERVER ACTION: saves the editor's resume as the session user (RE-REQ-033). */
export async function saveResumeAction(
  input: SaveResumeInput,
): Promise<SaveResumeResult | { ok: false; code: "UNAUTHORIZED"; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, code: "UNAUTHORIZED", error: "Sign in first." };

  const result = await saveResume(supabase, user, input, { surface: "page" });
  if (result.ok) {
    revalidatePath("/resume");
    revalidatePath(`/resume/${input.resumeId}`);
  }
  return result;
}
