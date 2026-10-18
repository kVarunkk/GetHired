"use server";

import { z } from "zod";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { applicationFormSchema } from "@/helpers/jobs/application-form-schema";
import type { QuestionSet } from "@/helpers/jobs/question-sets";
import { saveQuestionSet } from "@/helpers/jobs/save-question-set";

const inputSchema = z
  .object({
    id: z.string().uuid().optional(),
    name: z.string().trim().min(1, "Name the set.").max(80, "Names can be at most 80 characters."),
    form: applicationFormSchema,
  })
  .strict();

/** SERVER ACTION (AF-REQ-004): saves a form as a new set, or overwrites one (with `id`). */
export async function saveQuestionSetAction(
  input: z.input<typeof inputSchema>,
): Promise<{ ok: true; set: QuestionSet } | { ok: false; error: string }> {
  const auth = await requireCompanyForAction({ permission: "question_sets.manage" });
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the question set." };
  return saveQuestionSet(auth.supabase, auth.company.id, parsed.data);
}
