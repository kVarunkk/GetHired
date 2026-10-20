"use server";

import { z } from "zod";
import { getUserFromRequest } from "@/lib/supabase/get-user-from-request";
import { createClient } from "@/lib/supabase/server";

const inputSchema = z.object({ reviewId: z.string().uuid(), targetJd: z.string().max(30000) }).strict();

export type UpdateReviewJdResult = { ok: true } | { ok: false; error: string };

/** SERVER ACTION: saves the job description on one of the session user's resume reviews. */
export async function updateReviewJdAction(input: z.input<typeof inputSchema>): Promise<UpdateReviewJdResult> {
  const user = await getUserFromRequest();
  if (!user) return { ok: false, error: "Sign in first." };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "The job description is too long." };
  const { reviewId, targetJd } = parsed.data;

  const supabase = await createClient();
  const { data: updated, error } = await supabase
    .from("resume_reviews")
    .update({ target_jd: targetJd, updated_at: new Date().toISOString() })
    .eq("id", reviewId)
    .eq("user_id", user.id)
    .select("id");
  if (error || !updated || updated.length === 0) {
    return { ok: false, error: "Some error occured. Progress not saved." };
  }

  return { ok: true };
}
