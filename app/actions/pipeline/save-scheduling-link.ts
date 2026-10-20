"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireCompanyForAction } from "@/helpers/companies/require-company";

// The DB checks the same: https only, no spaces, at most 500 characters.
const httpsUrl = z
  .string()
  .trim()
  .max(500)
  .regex(/^https:\/\/[^\s<>"]+$/);
const inputSchema = z.object({ schedulingUrl: z.union([httpsUrl, z.literal("")]) }).strict();

/**
 * SERVER ACTION (PL-REQ-008): sets or clears the session company's scheduling
 * link, which `{{scheduling_link}}` inserts into interview invites. Owners and
 * admins only (TM-REQ-004).
 */
export async function saveSchedulingLinkAction(
  input: z.input<typeof inputSchema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await requireCompanyForAction({ permission: "settings.scheduling" });
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Use a link that starts with https://." };

  // company_info is owner-only; owners and admins change settings through this
  // RPC, which writes only the settings columns (teams difference 3).
  const { data, error } = await auth.supabase.rpc("update_company_settings", {
    p_settings: { scheduling_url: parsed.data.schedulingUrl || null },
  });
  if (error || !(data as { ok?: boolean } | null)?.ok) {
    return { ok: false, error: "Couldn't save the link. Please try again." };
  }

  revalidatePath("/company/settings/scheduling");
  // The templates preview shows the link.
  revalidatePath("/company/settings/email-templates");
  return { ok: true };
}
