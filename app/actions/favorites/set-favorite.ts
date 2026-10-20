"use server";

import { z } from "zod";
import { getUserFromRequest } from "@/lib/supabase/get-user-from-request";
import { createClient } from "@/lib/supabase/server";

const inputSchema = z
  .object({ kind: z.enum(["job", "company"]), targetId: z.string().uuid(), favorite: z.boolean() })
  .strict();

export type SetFavoriteResult = { ok: true } | { ok: false; error: string };

/** SERVER ACTION: stars or unstars a job or a company for the session applicant. */
export async function setFavoriteAction(input: z.input<typeof inputSchema>): Promise<SetFavoriteResult> {
  const user = await getUserFromRequest();
  if (!user) return { ok: false, error: "Sign in first." };
  if (user.app_metadata?.type === "company") return { ok: false, error: "Only applicants can save jobs." };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Not found." };
  const { kind, targetId, favorite } = parsed.data;

  const supabase = await createClient();
  let error: { code?: string } | null;
  if (kind === "job") {
    ({ error } = favorite
      ? await supabase.from("user_favorites").insert({ user_id: user.id, job_id: targetId })
      : await supabase.from("user_favorites").delete().eq("user_id", user.id).eq("job_id", targetId));
  } else {
    ({ error } = favorite
      ? await supabase.from("user_favorites_companies").insert({ user_id: user.id, company_id: targetId })
      : await supabase
          .from("user_favorites_companies")
          .delete()
          .eq("user_id", user.id)
          .eq("company_id", targetId));
  }
  // Already starred (unique violation) is what the user asked for.
  if (error && error.code !== "23505") return { ok: false, error: "Failed to update favorite status." };

  return { ok: true };
}
