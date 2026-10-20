"use server";

import { revalidateTag } from "next/cache";
import { z } from "zod";
import { getUserFromRequest } from "@/lib/supabase/get-user-from-request";
import { createClient } from "@/lib/supabase/server";

const inputSchema = z.object({ isPublic: z.boolean() }).strict();

export type SetProfileVisibilityResult = { ok: true } | { ok: false; error: string };

/** SERVER ACTION (BW-F01): the session user's `is_public`, and nothing else. */
export async function setProfileVisibilityAction(
  input: z.input<typeof inputSchema>,
): Promise<SetProfileVisibilityResult> {
  const user = await getUserFromRequest();
  if (!user) return { ok: false, error: "Sign in first." };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid setting." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("user_info")
    .update({ is_public: parsed.data.isPublic })
    .eq("user_id", user.id);
  if (error) return { ok: false, error: "Couldn't update your profile visibility. Please try again." };

  revalidateTag(`profile-${user.id}`);
  return { ok: true };
}
