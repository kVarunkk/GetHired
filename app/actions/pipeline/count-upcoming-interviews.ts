"use server";

import { z } from "zod";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { MAX_MOVE_APPLICATIONS } from "@/helpers/pipeline/move";

const inputSchema = z
  .object({ applicationIds: z.array(z.string().uuid()).min(1).max(MAX_MOVE_APPLICATIONS) })
  .strict();

export type CountUpcomingInterviewsResult = { ok: true; count: number } | { ok: false; error: string };

/**
 * SERVER ACTION (IVT-071, D14): how many upcoming interviews a move to
 * Rejected or Hired would cancel, for the move dialog's "Cancel N upcoming
 * interviews". `upcoming_interview_count` counts only applications on jobs
 * the member may move.
 */
export async function countUpcomingInterviewsAction(
  input: z.input<typeof inputSchema>,
): Promise<CountUpcomingInterviewsResult> {
  const auth = await requireCompanyForAction({ permission: "pipeline.move" });
  if (!auth.ok) return { ok: false, error: auth.error };
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose the applications to move." };

  const { data, error } = await auth.supabase.rpc("upcoming_interview_count", {
    p_application_ids: [...new Set(parsed.data.applicationIds)],
  });
  if (error) return { ok: false, error: "Couldn't check their interviews." };
  return { ok: true, count: data ?? 0 };
}
