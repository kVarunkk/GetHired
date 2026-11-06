"use server";

import { z } from "zod";
import {
  RESUME_EDIT_TOOLS,
  previewResumeEdit,
  type ResumeEditPreview,
} from "@/helpers/resumes/preview-resume-edit";
import { getUserFromRequest } from "@/lib/supabase/get-user-from-request";
import { createClient } from "@/lib/supabase/server";

const inputSchema = z.object({ tool: z.enum(RESUME_EDIT_TOOLS), input: z.unknown() }).strict();

/**
 * SERVER ACTION: the agent's approval card for a proposed resume change
 * (RE-REQ-072). Writes nothing. The user comes from the session.
 */
export async function previewAgentResumeEditAction(input: unknown): Promise<ResumeEditPreview> {
  const user = await getUserFromRequest();
  if (!user) return { ok: false, error: "Sign in first." };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Couldn't load the preview." };

  return previewResumeEdit(await createClient(), user, parsed.data.tool, parsed.data.input);
}
