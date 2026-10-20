"use server";

import { z } from "zod";
import { requireCompanyForAction } from "@/helpers/companies/require-company";

const inputSchema = z.object({ candidateId: z.string().uuid(), favorite: z.boolean() }).strict();

export type SetProfileFavoriteResult = { ok: true } | { ok: false; error: string };

/**
 * SERVER ACTION: adds a candidate to, or removes them from, the session
 * company's shortlist (`talent.save`). The same rules as the recruiter agent's
 * saveCandidate / unsaveCandidate: only candidates the company may see.
 */
export async function setProfileFavoriteAction(
  input: z.input<typeof inputSchema>,
): Promise<SetProfileFavoriteResult> {
  const auth = await requireCompanyForAction({ permission: "talent.save" });
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Candidate not found." };
  const { candidateId, favorite } = parsed.data;
  const { supabase, company } = auth;

  if (!favorite) {
    const { error } = await supabase
      .from("company_favorites")
      .delete()
      .eq("company_id", company.id)
      .eq("user_id", candidateId);
    if (error) return { ok: false, error: "Failed to update favorite status." };
    return { ok: true };
  }

  const { data: visible, error: viewError } = await supabase.rpc("company_can_view_candidate", {
    p_user_id: candidateId,
  });
  if (viewError) return { ok: false, error: "Failed to update favorite status." };
  if (visible !== true) return { ok: false, error: "Candidate not found." };

  const { data: existing } = await supabase
    .from("company_favorites")
    .select("id")
    .eq("company_id", company.id)
    .eq("user_id", candidateId)
    .limit(1);
  if ((existing ?? []).length > 0) return { ok: true };

  const { error } = await supabase
    .from("company_favorites")
    .insert({ company_id: company.id, user_id: candidateId });
  if (error) return { ok: false, error: "Failed to update favorite status." };
  return { ok: true };
}
