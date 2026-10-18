"use server";

import { z } from "zod";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { claimCareersSlug } from "@/helpers/careers/careers-writes";

const inputSchema = z.object({ slug: z.string().max(60) }).strict();

/**
 * SERVER ACTION (CP-REQ-001/002): changes the careers page address. The old
 * one keeps redirecting and stays reserved for 90 days (claim_careers_slug).
 */
export async function claimCareersSlugAction(
  input: z.input<typeof inputSchema>,
): Promise<{ ok: true; slug: string } | { ok: false; error: string }> {
  const auth = await requireCompanyForAction({ permission: "careers.edit" });
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Use 3 to 40 characters." };
  return claimCareersSlug(auth.supabase, auth.company.id, parsed.data.slug);
}
