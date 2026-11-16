// The job pipeline switch page's flow (JPT-036, JP-REQ-006): pick a target
// pipeline → its preview loads → adjust the mapping → save. Pure, so every
// event is tested in pipeline-switch-machine.test.ts. The async work (loading
// the preview, saving) stays in PipelineSwitchForm, which dispatches here.

import type { JobPipelineSwitchPreview, SwitchPreviewRow } from "@/helpers/pipeline/pipelines";

export type PipelineSwitchState = {
  /** The picked pipeline, or null before one is picked. */
  targetId: string | null;
  /** The preview for `targetId`, once loaded. */
  preview: JobPipelineSwitchPreview | null;
  /** `{ "<old stage id>": "<new stage id>" }` for the rows in use. */
  mapping: Record<string, string>;
  phase: "idle" | "loading" | "saving" | "saved";
  error: string | null;
};

export type PipelineSwitchEvent =
  | { type: "pickTarget"; targetId: string }
  | { type: "previewed"; preview: JobPipelineSwitchPreview }
  | { type: "previewFailed"; targetId: string; error: string }
  | { type: "mapStage"; stageId: string; targetStageId: string }
  | { type: "submit" }
  | { type: "failed"; error: string }
  | { type: "saved" };

export function initialPipelineSwitch(targetId: string | null = null): PipelineSwitchState {
  return { targetId, preview: null, mapping: {}, phase: targetId ? "loading" : "idle", error: null };
}

/** The rows the switch must move: each needs a target. */
export const rowsInUse = (preview: JobPipelineSwitchPreview): SwitchPreviewRow[] =>
  preview.rows.filter((row) => row.inUse);

/** Why Save is blocked, or null when it can go. */
export function blockedReason(state: PipelineSwitchState): "no_target" | "loading" | "same" | "missing" | "unmapped" | null {
  if (!state.targetId) return "no_target";
  if (!state.preview || state.phase === "loading") return "loading";
  if (state.preview.same) return "same";
  if (state.preview.missing.length > 0) return "missing";
  if (rowsInUse(state.preview).some((row) => !state.mapping[row.stage.id])) return "unmapped";
  return null;
}

export const canSave = (state: PipelineSwitchState) => state.phase === "idle" && blockedReason(state) === null;

export function pipelineSwitchReducer(state: PipelineSwitchState, event: PipelineSwitchEvent): PipelineSwitchState {
  switch (event.type) {
    case "pickTarget":
      if (state.phase === "saving" || state.phase === "saved") return state;
      if (event.targetId === state.targetId && state.preview) return state;
      return initialPipelineSwitch(event.targetId);

    case "previewed":
      // A preview for a target the user has since moved away from is dropped.
      if (event.preview.to.id !== state.targetId || state.phase !== "loading") return state;
      return { ...state, preview: event.preview, mapping: { ...event.preview.mapping }, phase: "idle", error: null };

    case "previewFailed":
      if (event.targetId !== state.targetId || state.phase !== "loading") return state;
      return { ...state, phase: "idle", error: event.error };

    case "mapStage": {
      if (state.phase !== "idle" || !state.preview) return state;
      const row = state.preview.rows.find((r) => r.stage.id === event.stageId);
      // Only rows in use are mapped, and only to a stage with the same candidate status.
      if (!row?.inUse || !row.options.some((o) => o.id === event.targetStageId)) return state;
      return { ...state, mapping: { ...state.mapping, [event.stageId]: event.targetStageId }, error: null };
    }

    case "submit":
      return canSave(state) ? { ...state, phase: "saving", error: null } : state;

    case "failed":
      return state.phase === "saving" ? { ...state, phase: "idle", error: event.error } : state;

    case "saved":
      return state.phase === "saving" ? { ...state, phase: "saved" } : state;
  }
}
