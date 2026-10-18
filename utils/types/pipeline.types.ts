import type { Enums } from "./database.types";

/** One card on the pipeline board (PL-TASK-011). Never carries contact details. */
export type BoardApplication = {
  id: string;
  stageId: string | null;
  name: string;
  /** The completed screening's score, or null. */
  fitScore: number | null;
  daysInStage: number;
  noteCount: number;
  /** strong_no..strong_yes scored 1–4, or null with no ratings. */
  ratingAvg: number | null;
  /** AF-REQ-003: the knockout questions it failed, or null when it passed (or had none). */
  knockoutReasons?: string[] | null;
};

export type BoardStage = {
  id: string;
  name: string;
  kind: Enums<"pipeline_stage_kind">;
};

/** `GET /api/company/job-posts/[job_id]/pipeline`. */
export type PipelineBoardData = {
  stages: BoardStage[];
  applications: BoardApplication[];
  /** Stages cut to the newest cards, with their full count (PL-ASSUMPTION-001). */
  truncated?: Record<string, number>;
};
