"use server";

import { z } from "zod";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { MAX_NOTE_LENGTH, updateNote } from "@/helpers/pipeline/notes";
import { Constants } from "@/utils/types/database.types";

const inputSchema = z
  .object({
    noteId: z.string().uuid(),
    body: z.string().max(MAX_NOTE_LENGTH * 2),
    rating: z.enum(Constants.public.Enums.candidate_rating).nullable(),
  })
  .strict();

/** SERVER ACTION (PL-TASK-020): edits one of the session user's own notes. */
export async function updateNoteAction(
  input: z.input<typeof inputSchema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await requireCompanyForAction({ permission: "notes.write" });
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Note not found." };

  const { noteId, ...changes } = parsed.data;
  return updateNote(auth, noteId, changes);
}
