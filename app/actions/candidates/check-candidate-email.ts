"use server";

import { z } from "zod";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { findExistingPerson, type ExistingPerson } from "@/helpers/candidates/existing-person";

const emailSchema = z.string().trim().max(254).email();

export type CheckCandidateEmailResult = { ok: true; existing: ExistingPerson | null } | { ok: false; error: string };

/**
 * SERVER ACTION (BI-REQ-009): as the hand-add form's email is typed, whether
 * it's already one of the company's candidates ("Open") or a GetHired user
 * in its pipeline ("Already in your pipeline"). Nothing for an invalid email.
 */
export async function checkCandidateEmailAction(input: { email: string }): Promise<CheckCandidateEmailResult> {
  const auth = await requireCompanyForAction({ permission: "applicants.import" });
  if (!auth.ok) return { ok: false, error: auth.error };

  const email = emailSchema.safeParse(input?.email);
  if (!email.success) return { ok: true, existing: null };

  return { ok: true, existing: await findExistingPerson(auth.supabase, auth.company.id, email.data) };
}
