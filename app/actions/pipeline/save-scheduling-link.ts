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
 * link, which `{{scheduling_link}}` inserts into interview invites.
 */
export async function saveSchedulingLinkAction(
  input: z.input<typeof inputSchema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await requireCompanyForAction();
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Use a link that starts with https://." };

  const { error } = await auth.supabase
    .from("company_info")
    .update({ scheduling_url: parsed.data.schedulingUrl || null })
    .eq("id", auth.company.id);
  if (error) return { ok: false, error: "Couldn't save the link. Please try again." };

  revalidatePath("/company/settings");
  return { ok: true };
}
