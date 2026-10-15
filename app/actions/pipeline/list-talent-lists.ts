"use server";

import { z } from "zod";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { listTalentLists, type TalentListSummary } from "@/helpers/pipeline/talent-lists";

const inputSchema = z.object({ candidateUserId: z.string().uuid().optional() }).strict();

/** SERVER ACTION (PL-TASK-051): the session company's lists, for the "Add to list" menu. */
export async function listTalentListsAction(
  input: z.input<typeof inputSchema> = {},
): Promise<{ ok: true; lists: TalentListSummary[] } | { ok: false; error: string }> {
  const auth = await requireCompanyForAction();
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Candidate not found." };

  try {
    return { ok: true, lists: await listTalentLists(auth, parsed.data) };
  } catch {
    return { ok: false, error: "Couldn't load your lists." };
  }
}
