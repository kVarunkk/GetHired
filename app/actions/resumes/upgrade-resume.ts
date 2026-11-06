"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { upgradeResumeFromFile } from "@/helpers/resumes/upgrade-resume";
import { createClient } from "@/lib/supabase/server";

const inputSchema = z.object({ resumeId: z.string().uuid() }).strict();

/** SERVER ACTION: upgrades a version 1 resume when its editor opens (RE-REQ-095). */
export async function upgradeResumeAction(
  input: z.input<typeof inputSchema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Resume not found." };

  // The ownership check: the service role only runs after this read finds it.
  const { data: resume, error } = await supabase
    .from("resumes")
    .select("id, name, content, revision, schema_version, resume_path")
    .eq("id", parsed.data.resumeId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw new Error(`Failed to read the resume: ${error.message}`);
  if (!resume) return { ok: false, error: "Resume not found." };
  if (resume.schema_version !== 1) return { ok: true };

  const result = await upgradeResumeFromFile(resume);
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath("/resume");
  revalidatePath(`/resume/${resume.id}`);
  return { ok: true };
}
