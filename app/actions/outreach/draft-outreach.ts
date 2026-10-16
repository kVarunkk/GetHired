"use server";

import { z } from "zod";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { draftOutreach, type DraftOutreachResult } from "@/helpers/outreach/draft";
import { eventCaptureServer } from "@/helpers/posthog/EventCaptureServer";
import { PostHogEvent } from "@/utils/types";

const inputSchema = z
  .object({
    candidateId: z.string().uuid(),
    jobPostId: z.string().uuid().nullable().optional(),
  })
  .strict();

/** SERVER ACTION (OR-TASK-040): "Draft with AI" in the outreach composer. Free; 20 a day per company. */
export async function draftOutreachAction(input: z.input<typeof inputSchema>): Promise<DraftOutreachResult> {
  const auth = await requireCompanyForAction();
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Candidate not found." };

  const result = await draftOutreach(auth, parsed.data);
  if (result.ok) {
    await eventCaptureServer({
      event: PostHogEvent.OutreachDrafted,
      distinctId: auth.user.id,
      properties: { has_job: Boolean(parsed.data.jobPostId) },
    });
  }
  return result;
}
