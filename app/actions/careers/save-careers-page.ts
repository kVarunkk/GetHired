"use server";

import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { saveCareersPage } from "@/helpers/careers/careers-writes";
import type { CareersPageInput } from "@/helpers/careers/page-schema";

/**
 * SERVER ACTION (CP-REQ-004/009, CP-SEC-002/003): saves the careers page's
 * accent, cover, sections and links. Validated here (markdown, https links,
 * a contrast-checked #rrggbb accent) and bounded again by save_careers_page.
 */
export async function saveCareersPageAction(input: CareersPageInput): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await requireCompanyForAction({ permission: "careers.edit" });
  if (!auth.ok) return { ok: false, error: auth.error };
  return saveCareersPage(auth.supabase, auth.company.id, input);
}
