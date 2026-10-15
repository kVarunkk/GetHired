"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireCompanyForAction } from "@/helpers/companies/require-company";

const inputSchema = z
  .object({
    notifyNewApplicants: z.enum(["off", "instant", "daily"]),
    notifyWeeklyMatches: z.boolean(),
  })
  .strict();

/**
 * SERVER ACTION (PL-REQ-009, PL-REQ-010): how the session company hears about
 * new applicants, and whether it gets the weekly matches email.
 */
export async function saveCompanyNotificationSettingsAction(
  input: z.input<typeof inputSchema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await requireCompanyForAction();
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose how you'd like to be notified." };

  const { error } = await auth.supabase
    .from("company_info")
    .update({
      notify_new_applicants: parsed.data.notifyNewApplicants,
      notify_weekly_matches: parsed.data.notifyWeeklyMatches,
    })
    .eq("id", auth.company.id);
  if (error) return { ok: false, error: "Couldn't save your settings. Please try again." };

  revalidatePath("/company/settings");
  return { ok: true };
}
