import type { Enums } from "@/utils/types/database.types";

export type PipelineStageKind = Enums<"pipeline_stage_kind">;
export type ApplicationStatus = Enums<"application_status">;

/**
 * §3.2 of the pipeline spec: the candidate-facing status for each stage kind.
 * The only TS copy of the map; the DB's `application_status_for_kind` mirrors
 * it, and the `applications_sync_status` trigger applies it on every move.
 */
const STATUS_FOR_KIND: Record<PipelineStageKind, ApplicationStatus> = {
  applied: "submitted",
  screening: "reviewed",
  interview: "reviewed",
  offer: "reviewed",
  hired: "selected",
  rejected: "rejected",
  on_hold: "stand_by",
};

/** The inverse, used by the backfill and status-only callers (`reviewed` → Screening). */
const KIND_FOR_STATUS: Record<ApplicationStatus, PipelineStageKind> = {
  submitted: "applied",
  reviewed: "screening",
  selected: "hired",
  rejected: "rejected",
  stand_by: "on_hold",
};

export function statusForKind(kind: PipelineStageKind): ApplicationStatus {
  return STATUS_FOR_KIND[kind];
}

export function inverseKind(status: ApplicationStatus): PipelineStageKind {
  return KIND_FOR_STATUS[status];
}

/** Whether moving from `from` to `to` changes what the candidate sees. */
export function changesCandidateStatus(
  from: PipelineStageKind | null,
  to: PipelineStageKind,
): boolean {
  return from === null || statusForKind(from) !== statusForKind(to);
}
