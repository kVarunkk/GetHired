// Client-safe limits for pipelines and their stages
// (plan/job-pipelines/feature-job-pipelines-spec.md). The SQL in
// 20261115130000_job_pipelines.sql holds the same numbers; config.test.ts
// keeps them in step.

/** JP-REQ-001: active pipelines per company. */
export const MAX_PIPELINES_PER_COMPANY = 10;
/** JP-REQ-001: a pipeline's name, after trimming. */
export const PIPELINE_NAME_MAX = 40;
/** PL-REQ-001 / JP-REQ-002: active stages per pipeline (not per company). */
export const MAX_ACTIVE_STAGES = 12;
/** PL-REQ-001: a stage's name. */
export const MAX_STAGE_NAME = 40;

/** Settings → Pipelines, the settings index (JPT-032). */
export const PIPELINES_SETTINGS_PATH = "/company/settings";
/** Where one pipeline's stage editor lives (JPT-033). */
export const PIPELINE_EDITOR_BASE = "/company/settings/pipelines";
export const pipelineEditorPath = (pipelineId: string) => `${PIPELINE_EDITOR_BASE}/${pipelineId}`;
