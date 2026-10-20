"use server";

import { z } from "zod";
import { getUserFromRequest } from "@/lib/supabase/get-user-from-request";
import { createClient } from "@/lib/supabase/server";

const inputSchema = z
  .object({ key: z.enum(["is_job_digest_active", "is_promotion_active"]), value: z.boolean() })
  .strict();

export type SetEmailPreferenceResult = { ok: true } | { ok: false; error: string };

/** SERVER ACTION (BW-F01): one of the session user's email subscriptions, and nothing else. */
export async function setEmailPreferenceAction(
  input: z.input<typeof inputSchema>,
): Promise<SetEmailPreferenceResult> {
  const user = await getUserFromRequest();
  if (!user) return { ok: false, error: "Sign in first." };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid setting." };

  const { key, value } = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase
    .from("user_info")
    .update(key === "is_job_digest_active" ? { is_job_digest_active: value } : { is_promotion_active: value })
    .eq("user_id", user.id);
  if (error) return { ok: false, error: "Couldn't save your preference. Please try again." };

  return { ok: true };
}
