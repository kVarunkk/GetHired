"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { eventCaptureServer } from "@/helpers/posthog/EventCaptureServer";
import { asTeamRpcResult, teamErrorMessage } from "@/helpers/team/errors";
import { PostHogEvent } from "@/utils/types";

const inputSchema = z
  .object({ userId: z.string().uuid(), confirmName: z.string().trim().max(200) })
  .strict();

/**
 * SERVER ACTION (RP-REQ-006, RP-DEC-002): an owner makes another owner the
 * primary owner, who becomes the billing contact (`company_info.user_id`).
 * Typing the company name confirms it, checked here too.
 */
export async function makePrimaryOwnerAction(
  input: z.input<typeof inputSchema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await requireCompanyForAction({ owner: true });
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: teamErrorMessage("invalid_target") };

  const expected = (auth.company.name ?? "").trim().toLowerCase();
  if (!expected || parsed.data.confirmName.toLowerCase() !== expected) {
    return { ok: false, error: "Type the company name exactly to confirm." };
  }

  const { data, error } = await auth.supabase.rpc("make_primary_owner", { p_user_id: parsed.data.userId });
  if (error) return { ok: false, error: teamErrorMessage("unknown") };
  const result = asTeamRpcResult(data);
  if (!result.ok) return { ok: false, error: teamErrorMessage(result.reason) };

  revalidatePath("/company", "layout");
  await eventCaptureServer({ event: PostHogEvent.TeamPrimaryOwnerChanged, distinctId: auth.user.id });
  return { ok: true };
}
