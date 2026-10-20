"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getUserFromRequest } from "@/lib/supabase/get-user-from-request";
import { createClient } from "@/lib/supabase/server";

const preferencesSchema = z.object({ acceptsOutreach: z.boolean() }).strict();
const unblockSchema = z.object({ companyId: z.string().uuid() }).strict();

export type OutreachPreferenceResult = { ok: true } | { ok: false; error: string };

/** SERVER ACTION (OR-REQ-012): the session user's `accepts_outreach`, and nothing else. */
export async function setOutreachPreferencesAction(
  input: z.input<typeof preferencesSchema>,
): Promise<OutreachPreferenceResult> {
  const user = await getUserFromRequest();
  if (!user) return { ok: false, error: "Sign in first." };

  const parsed = preferencesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid setting." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("user_info")
    .update({ accepts_outreach: parsed.data.acceptsOutreach })
    .eq("user_id", user.id);
  if (error) return { ok: false, error: "Couldn't save the setting. Try again." };

  revalidatePath("/settings");
  return { ok: true };
}

/** SERVER ACTION: removes one of the session user's own blocks. */
export async function unblockCompanyAction(
  input: z.input<typeof unblockSchema>,
): Promise<OutreachPreferenceResult> {
  const user = await getUserFromRequest();
  if (!user) return { ok: false, error: "Sign in first." };

  const parsed = unblockSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Company not found." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("candidate_company_blocks")
    .delete()
    .eq("candidate_user_id", user.id)
    .eq("company_id", parsed.data.companyId);
  if (error) return { ok: false, error: "Couldn't unblock the company. Try again." };

  revalidatePath("/settings");
  return { ok: true };
}
