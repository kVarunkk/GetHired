"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { deleteResume, type DeleteResumeResult } from "@/helpers/resumes/delete-resume";
import { createClient } from "@/lib/supabase/server";

const inputSchema = z.object({ resumeId: z.string().uuid() }).strict();

/** SERVER ACTION: deletes one of the session user's resumes (RE-REQ-037). */
export async function deleteResumeAction(input: z.input<typeof inputSchema>): Promise<DeleteResumeResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Resume not found." };

  const result = await deleteResume(supabase, user, parsed.data);
  if (result.ok) {
    revalidatePath("/resume");
    revalidatePath(`/resume/${parsed.data.resumeId}`);
  }
  return result;
}
