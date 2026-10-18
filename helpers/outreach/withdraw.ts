import { revalidatePath } from "next/cache";
import { eventCaptureServer } from "@/helpers/posthog/EventCaptureServer";
import { isUuid } from "@/helpers/agent/auth";
import { PostHogEvent } from "@/utils/types";
import type { OutreachSource } from "@/utils/types/outreach.types";
import type { OutreachDeps } from "./send";

export type WithdrawOutreachResult =
  | { ok: true; candidateUserId: string }
  | { ok: false; error: string };

/**
 * Withdraws one of the company's open outreach. RLS allows a member to set
 * only `status`, only from `sent` to `withdrawn`, only on the company's own
 * rows (OR-SEC-003); the filters here say the same. Shared by the server
 * action and the recruiter agent; `company` must come from the session, and
 * the caller checks outreach.view.
 */
export async function withdrawOutreach(
  { supabase, company, user }: OutreachDeps,
  outreachId: string,
  { source }: { source: OutreachSource },
): Promise<WithdrawOutreachResult> {
  if (typeof outreachId !== "string" || !isUuid(outreachId)) return { ok: false, error: "Outreach not found." };

  const { data, error } = await supabase
    .from("candidate_outreach")
    .update({ status: "withdrawn" })
    .eq("id", outreachId)
    .eq("company_id", company.id)
    .eq("status", "sent")
    .select("id, candidate_user_id");

  if (error) return { ok: false, error: "Couldn't withdraw the message. Try again." };
  const row = data?.[0];
  if (!row) return { ok: false, error: "Only an unanswered message can be withdrawn." };

  revalidatePath("/company/outreach");
  revalidatePath(`/company/outreach/${row.id}`);
  revalidatePath(`/company/profiles/${row.candidate_user_id}`);
  await eventCaptureServer({ event: PostHogEvent.OutreachWithdrawn, distinctId: user.id, properties: { source } });
  return { ok: true, candidateUserId: row.candidate_user_id };
}
