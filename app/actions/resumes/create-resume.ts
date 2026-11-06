"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { RESUME_LIMITS } from "@/helpers/resume/config";
import { createResume, type CreateResumeResult } from "@/helpers/resumes/create-resume";
import { createClient } from "@/lib/supabase/server";

const inputSchema = z.object({ name: z.string().max(RESUME_LIMITS.shortFieldChars).optional() }).strict();

/** SERVER ACTION: starts a blank resume for the session user (RE-REQ-035). */
export async function createResumeAction(input: z.input<typeof inputSchema> = {}): Promise<CreateResumeResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the name and try again." };

  const result = await createResume(supabase, user, parsed.data);
  if (result.ok) revalidatePath("/resume");
  return result;
}
