"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { eventCaptureServer } from "@/helpers/posthog/EventCaptureServer";
import { PostHogEvent } from "@/utils/types";

const inputSchema = z.object({ outreachId: z.string().uuid() }).strict();

export type WithdrawOutreachResult = { ok: true } | { ok: false; error: string };

/**
 * SERVER ACTION: withdraws one of the company's open outreach. RLS allows a
 * member to set only `status`, only from `sent` to `withdrawn`, only on the
 * company's own rows (OR-SEC-003); the filters here say the same.
 */
export async function withdrawOutreachAction(
  input: z.input<typeof inputSchema>,
): Promise<WithdrawOutreachResult> {
  const auth = await requireCompanyForAction();
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Outreach not found." };

  const { data, error } = await auth.supabase
    .from("candidate_outreach")
    .update({ status: "withdrawn" })
    .eq("id", parsed.data.outreachId)
    .eq("company_id", auth.company.id)
    .eq("status", "sent")
    .select("id, candidate_user_id");

  if (error) return { ok: false, error: "Couldn't withdraw the message. Try again." };
  const row = data?.[0];
  if (!row) return { ok: false, error: "Only an unanswered message can be withdrawn." };

  revalidatePath("/company/outreach");
  revalidatePath(`/company/profiles/${row.candidate_user_id}`);
  await eventCaptureServer({ event: PostHogEvent.OutreachWithdrawn, distinctId: auth.user.id });
  return { ok: true };
}
