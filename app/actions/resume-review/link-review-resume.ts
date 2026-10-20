"use server";

import { z } from "zod";
import { getUserFromRequest } from "@/lib/supabase/get-user-from-request";
import { createClient } from "@/lib/supabase/server";

const inputSchema = z.object({ reviewId: z.string().uuid(), resumeId: z.string().uuid() }).strict();

export type LinkReviewResumeResult = { ok: true } | { ok: false; error: string };

/** SERVER ACTION: links one of the session user's resumes to one of their resume reviews. */
export async function linkReviewResumeAction(
  input: z.input<typeof inputSchema>,
): Promise<LinkReviewResumeResult> {
  const user = await getUserFromRequest();
  if (!user) return { ok: false, error: "Sign in first." };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Resume not found." };
  const { reviewId, resumeId } = parsed.data;

  const supabase = await createClient();
  const { data: resume } = await supabase
    .from("resumes")
    .select("id")
    .eq("id", resumeId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!resume) return { ok: false, error: "Resume not found." };

  const { data: updated, error } = await supabase
    .from("resume_reviews")
    .update({ resume_id: resumeId, updated_at: new Date().toISOString() })
    .eq("id", reviewId)
    .eq("user_id", user.id)
    .select("id");
  if (error || !updated || updated.length === 0) return { ok: false, error: "Failed to link resume asset." };

  return { ok: true };
}
