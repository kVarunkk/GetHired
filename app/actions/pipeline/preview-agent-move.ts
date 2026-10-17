"use server";

import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { moveApplicationsInput, toMoveEmail } from "@/helpers/agent/roles/recruiter/tools/pipeline";
import { previewMove, type MoveFailure, type MovePreview } from "@/helpers/pipeline/move";

export type PreviewAgentMoveResult = MovePreview | (Omit<MoveFailure, "ok"> & { ok: false });

/**
 * SERVER ACTION (RA-TASK-040): what the agent's proposed `moveApplications`
 * call would do, for its approval card: the stage, the applicants by name,
 * who gets emailed and the rendered email (RA-REQ-005). Writes and sends
 * nothing. The company comes from the session.
 */
export async function previewAgentMoveAction(input: unknown): Promise<PreviewAgentMoveResult> {
  const auth = await requireCompanyForAction({ permission: "pipeline.move" });
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = moveApplicationsInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Couldn't read this move." };
  const { applicationIds, stageId, email } = parsed.data;

  return previewMove(auth, { applicationIds, stageId, email: toMoveEmail(email) });
}
