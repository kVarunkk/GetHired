import "server-only";
import { companyAllows } from "@/helpers/companies/require-company";
import type { CompanySessionContext } from "@/helpers/companies/company-session";
import { moveApplicationsInput, toMoveEmail } from "@/helpers/agent/roles/recruiter/tools/pipeline";
import { previewMove, type MoveFailure, type MovePreview } from "./move";

export type PreviewAgentMoveResult = MovePreview | (Omit<MoveFailure, "ok"> & { ok: false });

/**
 * RA-TASK-040: what a proposed `moveApplications` call would do: the stage,
 * the applicants by name, who gets emailed and the rendered email
 * (RA-REQ-005). Writes and sends nothing. Shared by the agent's approval card
 * (through `previewAgentMoveAction`) and MCP's confirmation.
 */
export async function previewAgentMove(session: CompanySessionContext, input: unknown): Promise<PreviewAgentMoveResult> {
  const denied = companyAllows(session.company, { permission: "pipeline.move" });
  if (denied) return { ok: false, error: denied };

  const parsed = moveApplicationsInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Couldn't read this move." };
  const { applicationIds, stageId, email } = parsed.data;

  return previewMove(session, { applicationIds, stageId, email: toMoveEmail(email) });
}
