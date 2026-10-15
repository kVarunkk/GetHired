"use server";

import { z } from "zod";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { deleteNote } from "@/helpers/pipeline/notes";

const inputSchema = z.object({ noteId: z.string().uuid() }).strict();

/** SERVER ACTION (PL-TASK-020): deletes one of the session user's own notes. */
export async function deleteNoteAction(
  input: z.input<typeof inputSchema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await requireCompanyForAction();
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Note not found." };

  return deleteNote(auth, parsed.data.noteId);
}
