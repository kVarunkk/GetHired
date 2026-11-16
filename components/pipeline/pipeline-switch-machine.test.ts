import { describe, expect, it } from "vitest";
import type { JobPipelineSwitchPreview, SwitchPreviewRow } from "@/helpers/pipeline/pipelines";
import {
  blockedReason,
  canSave,
  initialPipelineSwitch,
  pipelineSwitchReducer as reduce,
  type PipelineSwitchState,
} from "./pipeline-switch-machine";

const ENG = "7d1a3c2e-4b5f-8a6d-9e9f-0a1b2c3d4e5f";
const SALES = "7d1a3c2e-4b5f-8a6d-9e9f-0a1b2c3d4e60";

const row = (id: string, overrides: Partial<SwitchPreviewRow> = {}): SwitchPreviewRow => ({
  stage: { id, name: id, kind: "screening", archived: false },
  status: "reviewed",
  applications: 1,
  planItems: 0,
  inUse: true,
  options: [
    { id: "phone", name: "Phone screen", kind: "screening" },
    { id: "tech", name: "Tech interview", kind: "interview" },
  ],
  defaultTargetId: "phone",
  ...overrides,
});

const previewOf = (overrides: Partial<JobPipelineSwitchPreview> = {}): JobPipelineSwitchPreview => ({
  ok: true,
  job: { id: "job", title: "Backend" },
  from: { id: "default", name: "Default" },
  to: { id: ENG, name: "Engineering" },
  same: false,
  rows: [row("screen"), row("interview", { defaultTargetId: "tech" }), row("offer", { inUse: false, applications: 0 })],
  mapping: { screen: "phone", interview: "tech" },
  missing: [],
  ...overrides,
});

const loaded = (preview = previewOf()): PipelineSwitchState =>
  reduce(initialPipelineSwitch(preview.to.id), { type: "previewed", preview });

describe("pipeline switch machine (JPT-036)", () => {
  it("starts idle with no target, or loading with a preselected one", () => {
    expect(initialPipelineSwitch()).toMatchObject({ targetId: null, phase: "idle" });
    expect(blockedReason(initialPipelineSwitch())).toBe("no_target");
    expect(initialPipelineSwitch(ENG)).toMatchObject({ targetId: ENG, phase: "loading" });
    expect(blockedReason(initialPipelineSwitch(ENG))).toBe("loading");
  });

  it("picking a target starts loading its preview and clears the old one", () => {
    const next = reduce(loaded(), { type: "pickTarget", targetId: SALES });
    expect(next).toEqual({ targetId: SALES, preview: null, mapping: {}, phase: "loading", error: null });
  });

  it("picking the loaded target again keeps the mapping", () => {
    const state = reduce(loaded(), { type: "mapStage", stageId: "screen", targetStageId: "tech" });
    expect(reduce(state, { type: "pickTarget", targetId: ENG })).toBe(state);
  });

  it("takes the preview's default mapping and can save", () => {
    const state = loaded();
    expect(state.mapping).toEqual({ screen: "phone", interview: "tech" });
    expect(state.phase).toBe("idle");
    expect(canSave(state)).toBe(true);
  });

  it("drops a preview for a target the user moved away from", () => {
    const state = reduce(initialPipelineSwitch(ENG), { type: "pickTarget", targetId: SALES });
    expect(reduce(state, { type: "previewed", preview: previewOf() })).toBe(state);
    expect(reduce(state, { type: "previewFailed", targetId: ENG, error: "x" })).toBe(state);
  });

  it("a failed preview shows the error", () => {
    const state = reduce(initialPipelineSwitch(ENG), { type: "previewFailed", targetId: ENG, error: "Pipeline not found." });
    expect(state).toMatchObject({ phase: "idle", error: "Pipeline not found." });
    expect(canSave(state)).toBe(false);
  });

  it("maps a row in use to one of its options", () => {
    const state = reduce(loaded(), { type: "mapStage", stageId: "screen", targetStageId: "tech" });
    expect(state.mapping.screen).toBe("tech");
  });

  it("ignores a target outside the row's options (another candidate status), and rows not in use", () => {
    const state = loaded();
    expect(reduce(state, { type: "mapStage", stageId: "screen", targetStageId: "hired" })).toBe(state);
    expect(reduce(state, { type: "mapStage", stageId: "offer", targetStageId: "phone" })).toBe(state);
    expect(reduce(state, { type: "mapStage", stageId: "nope", targetStageId: "phone" })).toBe(state);
  });

  it("is blocked when a needed status is missing from the target (JP-TEST-005)", () => {
    const preview = previewOf({
      rows: [row("hold", { stage: { id: "hold", name: "On hold", kind: "on_hold", archived: false }, status: "stand_by", options: [], defaultTargetId: null })],
      mapping: {},
      missing: [{ stage: { id: "hold", name: "On hold", kind: "on_hold" }, status: "stand_by" }],
    });
    const state = loaded(preview);
    expect(blockedReason(state)).toBe("missing");
    expect(reduce(state, { type: "submit" })).toBe(state);
  });

  it("is blocked when the target is the job's own pipeline", () => {
    const state = loaded(previewOf({ same: true, mapping: {} }));
    expect(blockedReason(state)).toBe("same");
  });

  it("is blocked when a row in use has no target", () => {
    const state = loaded(previewOf({ mapping: { screen: "phone" } }));
    expect(blockedReason(state)).toBe("unmapped");
  });

  it("submit → saving → saved", () => {
    const saving = reduce(loaded(), { type: "submit" });
    expect(saving.phase).toBe("saving");
    // No edits or new targets while saving.
    expect(reduce(saving, { type: "mapStage", stageId: "screen", targetStageId: "tech" })).toBe(saving);
    expect(reduce(saving, { type: "pickTarget", targetId: SALES })).toBe(saving);
    expect(reduce(saving, { type: "saved" }).phase).toBe("saved");
  });

  it("a refused save keeps the mapping and shows the error", () => {
    const saving = reduce(loaded(), { type: "submit" });
    const failed = reduce(saving, { type: "failed", error: "No On hold stage." });
    expect(failed).toMatchObject({ phase: "idle", error: "No On hold stage.", mapping: saving.mapping });
    expect(reduce(loaded(), { type: "failed", error: "x" }).error).toBeNull();
  });
});
