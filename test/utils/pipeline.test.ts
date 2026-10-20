import { describe, expect, it } from "vitest";
import { COMPANY_A } from "./recruiter";
import {
  DEFAULT_STAGES,
  PIPELINE_STAGE_KINDS,
  eventOf,
  noteOf,
  pipelineAppOf,
  stageOf,
  templateOf,
} from "./pipeline";

// The stage, move and seed tests (PL-TEST-001/002/004) lean on these; a
// fixture with a missing or duplicated kind would let them pass vacuously.
describe("pipeline fixtures", () => {
  it("has exactly one default stage of each kind", () => {
    const kinds = DEFAULT_STAGES.map((s) => s.kind);
    expect([...kinds].sort()).toEqual([...PIPELINE_STAGE_KINDS].sort());
  });

  it("numbers the default stages from 0 without gaps", () => {
    expect(DEFAULT_STAGES.map((s) => s.position)).toEqual(
      DEFAULT_STAGES.map((_, i) => i),
    );
  });

  it("includes the protected kinds applied, hired and rejected", () => {
    const kinds = new Set(DEFAULT_STAGES.map((s) => s.kind));
    for (const kind of ["applied", "hired", "rejected"] as const) {
      expect(kinds.has(kind)).toBe(true);
    }
  });

  it("follows the PL-REQ-001 order", () => {
    expect(DEFAULT_STAGES.map((s) => s.name)).toEqual([
      "Applied",
      "Screening",
      "Interview",
      "Offer",
      "Hired",
      "Rejected",
      "On hold",
    ]);
  });

  it("gives every default stage a unique id owned by COMPANY_A", () => {
    expect(new Set(DEFAULT_STAGES.map((s) => s.id)).size).toBe(DEFAULT_STAGES.length);
    expect(DEFAULT_STAGES.every((s) => s.company_id === COMPANY_A.id && !s.archived)).toBe(true);
  });

  it("stageOf returns the default stage of a kind, with overrides", () => {
    const interview = stageOf("interview");
    expect(interview).toBe(DEFAULT_STAGES.find((s) => s.kind === "interview"));
    expect(stageOf("offer", { archived: true })).toMatchObject({ kind: "offer", archived: true });
  });

  it("pipelineAppOf builds a platform application in the Applied stage by default", () => {
    const app = pipelineAppOf();
    expect(app.job_post_id).toBeTruthy();
    expect(app.stage_id).toBe(stageOf("applied").id);
    expect(app.status).toBe("submitted");
    expect(app.source).toBe("applied");
    expect(app.user_info.email).toMatch(/@/);
    expect(app.job_postings.company_id).toBe(COMPANY_A.id);
    expect(app.job_postings.company_info.name).toBe(COMPANY_A.info.name);
    expect(pipelineAppOf().id).not.toBe(app.id);
  });

  it("templateOf, noteOf and eventOf belong to COMPANY_A", () => {
    expect(templateOf("rejection")).toMatchObject({ purpose: "rejection", company_id: COMPANY_A.id });
    expect(noteOf()).toMatchObject({ company_id: COMPANY_A.id, rating: null });
    expect(eventOf("stage_changed")).toMatchObject({ type: "stage_changed", company_id: COMPANY_A.id });
  });
});
