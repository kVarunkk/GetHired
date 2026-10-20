"use server";

import { z } from "zod";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { setCareersPublished } from "@/helpers/careers/careers-writes";

const inputSchema = z.object({ published: z.boolean() }).strict();

/** SERVER ACTION (CP-REQ-008): publishes or unpublishes the careers page. */
export async function setCareersPublishedAction(
  input: z.input<typeof inputSchema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await requireCompanyForAction({ permission: "careers.edit" });
  if (!auth.ok) return { ok: false, error: auth.error };
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Something went wrong. Reload and try again." };
  return setCareersPublished(auth.supabase, auth.company.id, parsed.data.published);
}
