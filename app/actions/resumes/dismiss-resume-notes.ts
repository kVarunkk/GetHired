"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const inputSchema = z.object({ resumeId: z.string().uuid() }).strict();

/**
 * SERVER ACTION: clears the "lines weren't added" notice (RE-REQ-016). It
 * leaves the resume itself alone, so the revision doesn't change and a dismiss
 * can't conflict with the editor's next save.
 */
export async function dismissResumeNotesAction(
  input: z.input<typeof inputSchema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Resume not found." };

  const { data, error } = await supabase
    .from("resumes")
    .update({ parse_notes: null })
    .eq("id", parsed.data.resumeId)
    .eq("user_id", user.id)
    .select("id");
  if (error || !data?.length) return { ok: false, error: "Couldn't dismiss this. Please try again." };

  revalidatePath(`/resume/${parsed.data.resumeId}`);
  return { ok: true };
}
