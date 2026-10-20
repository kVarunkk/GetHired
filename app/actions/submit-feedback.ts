"use server";

import { z } from "zod";
import { getUserFromRequest } from "@/lib/supabase/get-user-from-request";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

const inputSchema = z.object({ content: z.string().trim().min(1).max(5000) }).strict();

export type SubmitFeedbackResult = { ok: true } | { ok: false; error: string };

/**
 * SERVER ACTION: stores feedback from the session user. The service role
 * writes it because the `feedbacks` insert policy only covers applicants
 * (BW-F09); the author always comes from the session.
 */
export async function submitFeedbackAction(input: z.input<typeof inputSchema>): Promise<SubmitFeedbackResult> {
  const user = await getUserFromRequest();
  if (!user) return { ok: false, error: "Sign in first." };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Write your feedback first (up to 5000 characters)." };

  const isCompany = user.app_metadata?.type === "company";
  const { error } = await createServiceRoleClient()
    .from("feedbacks")
    .insert({ content: parsed.data.content, ...(isCompany ? { company_user_id: user.id } : { user_id: user.id }) });
  if (error) return { ok: false, error: "Some error occured. Please try again later." };

  return { ok: true };
}
