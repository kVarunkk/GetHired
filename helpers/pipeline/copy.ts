// Client-safe copy for pipelines (plan/job-pipelines/feature-job-pipelines-spec.md).
import { forbiddenMessage } from "@/helpers/companies/permissions";
import { MAX_PIPELINES_PER_COMPANY, PIPELINE_NAME_MAX } from "./config";
import type { ApplicationStatus } from "./status-map";

/** A move that skips an application because the stage isn't in its job's pipeline (JP-REQ-004). */
export const OTHER_PIPELINE_COPY = "That stage isn't in this job's pipeline.";

export const PIPELINE_NOT_FOUND = "Pipeline not found.";

/** What the candidate sees for each status, for the switch's missing-status message. */
export const CANDIDATE_STATUS_LABELS: Record<ApplicationStatus, string> = {
  submitted: "Submitted",
  reviewed: "Reviewed",
  selected: "Selected",
  rejected: "Rejected",
  stand_by: "On hold",
};

/** Every `{ ok: false, reason }` the pipeline RPCs return. */
export type PipelineReason =
  | "not_found"
  | "forbidden"
  | "invalid_name"
  | "name_taken"
  | "limit_reached"
  | "pipeline_not_found"
  | "is_default"
  | "in_use"
  | "invalid_mapping"
  | "status_mismatch"
  | "missing_status";

/** The stage a switch refusal names. */
export type RefusedStage = { id: string; name: string; kind: string };

export function pipelineReasonCopy(
  reason: string,
  detail: {
    /** Which permission a `forbidden` means. */
    permission?: "settings.stages" | "jobs.edit";
    jobs?: number;
    stage?: RefusedStage | null;
    status?: ApplicationStatus | null;
  } = {},
): string {
  const stage = detail.stage?.name ? `"${detail.stage.name}"` : "a stage";
  switch (reason) {
    case "not_found":
      return "Job not found.";
    case "forbidden":
      return detail.permission === "jobs.edit"
        ? forbiddenMessage("jobs.edit", { forJob: true })
        : forbiddenMessage("settings.stages");
    case "invalid_name":
      return `Pipeline names are 1 to ${PIPELINE_NAME_MAX} characters.`;
    case "name_taken":
      return "Another pipeline already has that name.";
    case "limit_reached":
      return `A company can have at most ${MAX_PIPELINES_PER_COMPANY} pipelines. Archive one first.`;
    case "pipeline_not_found":
      return PIPELINE_NOT_FOUND;
    case "is_default":
      return "The default pipeline can't be archived. Make another pipeline the default first.";
    case "in_use": {
      const n = detail.jobs ?? 0;
      return n > 0
        ? `${n} job${n === 1 ? " uses" : "s use"} this pipeline. Switch ${n === 1 ? "it" : "them"} to another pipeline first.`
        : "Jobs use this pipeline. Switch them to another pipeline first.";
    }
    case "invalid_mapping":
      return `Pick a stage in the new pipeline for ${stage}.`;
    case "status_mismatch":
      return `${stage} must map to a stage that shows candidates the same status.`;
    case "missing_status": {
      const label = detail.status ? CANDIDATE_STATUS_LABELS[detail.status] : null;
      return label
        ? `The new pipeline has no stage that shows candidates "${label}", which ${stage} needs. Add one to it first.`
        : `The new pipeline has no stage for the candidates in ${stage}. Add one to it first.`;
    }
    default:
      return "Something went wrong. Try again.";
  }
}
