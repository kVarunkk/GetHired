"use server";

import { z } from "zod";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { deleteQuestionSet } from "@/helpers/jobs/save-question-set";

const inputSchema = z.object({ id: z.string().uuid() }).strict();

/** SERVER ACTION (AF-REQ-004): deletes a question set. Jobs it was applied to keep their copy. */
export async function deleteQuestionSetAction(
  input: z.input<typeof inputSchema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await requireCompanyForAction({ permission: "question_sets.manage" });
  if (!auth.ok) return { ok: false, error: auth.error };
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Question set not found." };
  return deleteQuestionSet(auth.supabase, auth.company.id, parsed.data.id);
}
