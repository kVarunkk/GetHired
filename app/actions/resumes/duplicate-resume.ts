"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { RESUME_LIMITS } from "@/helpers/resume/config";
import { duplicateResume, type DuplicateResumeResult } from "@/helpers/resumes/duplicate-resume";
import { createClient } from "@/lib/supabase/server";

const inputSchema = z
  .object({ resumeId: z.string().uuid(), name: z.string().max(RESUME_LIMITS.shortFieldChars).optional() })
  .strict();

/** SERVER ACTION: copies one of the session user's resumes (RE-REQ-040). */
export async function duplicateResumeAction(input: z.input<typeof inputSchema>): Promise<DuplicateResumeResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Resume not found." };

  const result = await duplicateResume(supabase, user, parsed.data);
  if (result.ok) revalidatePath("/resume");
  return result;
}
