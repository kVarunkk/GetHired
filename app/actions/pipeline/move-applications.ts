"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import {
  MAX_MOVE_APPLICATIONS,
  moveApplications,
  type MoveFailure,
  type MoveSkipReason,
} from "@/helpers/pipeline/move";
import {
  MAX_TEMPLATE_BODY,
  MAX_TEMPLATE_SUBJECT,
} from "@/helpers/pipeline/templates";
import { eventCaptureServer } from "@/helpers/posthog/EventCaptureServer";
import { PostHogEvent } from "@/utils/types";

const inputSchema = z
  .object({
    applicationIds: z
      .array(z.string().uuid())
      .min(1)
      .max(MAX_MOVE_APPLICATIONS),
    stageId: z.string().uuid(),
    email: z
      .object({
        templateId: z.string().uuid(),
        // Before rendering; the rendered limits are checked by renderTemplate.
        overrides: z
          .object({
            // A missing one keeps the template's.
            subject: z.string().max(MAX_TEMPLATE_SUBJECT * 2).optional(),
            body: z.string().max(MAX_TEMPLATE_BODY * 2).optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type MoveApplicationsActionResult =
  | {
      ok: true;
      moved: number;
      emailed: number;
      skipped: { id: string; reason: MoveSkipReason }[];
    }
  | (Omit<MoveFailure, "ok"> & { ok: false });

/**
 * SERVER ACTION (PL-TASK-003): moves the session company's applications to
 * one of its stages. The work is in `helpers/pipeline/move.ts`; the company
 * always comes from the session.
 */
export async function moveApplicationsAction(
  input: z.input<typeof inputSchema>,
): Promise<MoveApplicationsActionResult> {
  const auth = await requireCompanyForAction({ permission: "pipeline.move" });
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: `Choose 1 to ${MAX_MOVE_APPLICATIONS} applications and a stage.`,
    };
  }

  const result = await moveApplications(auth, parsed.data);
  if (!result.ok) return result;

  const moved = new Set(result.movedIds);
  const movedApps = result.applications.filter((a) => moved.has(a.id));
  for (const jobPostId of new Set(movedApps.map((a) => a.jobPostId))) {
    revalidatePath(`/company/job-posts/${jobPostId}`);
    revalidatePath(`/company/job-posts/${jobPostId}/applications`);
  }

  if (result.moved > 0) {
    const fromKinds = new Set(movedApps.map((a) => a.fromKind));
    await eventCaptureServer({
      event: PostHogEvent.PipelineStageMoved,
      distinctId: auth.user.id,
      properties: {
        count: result.moved,
        from_kind: fromKinds.size === 1 ? [...fromKinds][0] : "mixed",
        to_kind: result.stage.kind,
        emailed: result.emailed,
      },
    });
  }

  return {
    ok: true,
    moved: result.moved,
    emailed: result.emailed,
    skipped: result.skipped,
  };
}
