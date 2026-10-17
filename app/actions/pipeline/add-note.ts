"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { MAX_NOTE_LENGTH, addNote, type CandidateNote } from "@/helpers/pipeline/notes";
import { eventCaptureServer } from "@/helpers/posthog/EventCaptureServer";
import { Constants } from "@/utils/types/database.types";
import { PostHogEvent } from "@/utils/types";

const inputSchema = z
  .object({
    body: z.string().max(MAX_NOTE_LENGTH * 2),
    rating: z.enum(Constants.public.Enums.candidate_rating).nullable().optional(),
    applicationId: z.string().uuid().optional(),
    candidateUserId: z.string().uuid().optional(),
  })
  .strict()
  .refine((v) => (v.applicationId === undefined) !== (v.candidateUserId === undefined));

export type AddNoteActionResult = { ok: true; note: CandidateNote } | { ok: false; error: string };

/**
 * SERVER ACTION (PL-TASK-020): adds a note by the session user on an
 * application or a talent-pool candidate. The checks are in
 * `helpers/pipeline/notes.ts`.
 */
export async function addNoteAction(input: z.input<typeof inputSchema>): Promise<AddNoteActionResult> {
  const auth = await requireCompanyForAction({ permission: "notes.write" });
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Write a note for one application or candidate." };

  const result = await addNote(auth, parsed.data);
  if (!result.ok) return result;

  if (result.note.application_id) revalidatePath(`/company/applicants/${result.note.application_id}`);
  await eventCaptureServer({
    event: PostHogEvent.PipelineNoteAdded,
    distinctId: auth.user.id,
    properties: { rated: result.note.rating !== null },
  });

  return { ok: true, note: result.note };
}
