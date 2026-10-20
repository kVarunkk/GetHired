import { describe, expect, it } from "vitest";
import { Constants } from "@/utils/types/database.types";
import { changesCandidateStatus, inverseKind, statusForKind } from "./status-map";

const KINDS = Constants.public.Enums.pipeline_stage_kind;
const STATUSES = Constants.public.Enums.application_status;

// PL-TEST-001: the §3.2 table, which the DB functions
// application_status_for_kind / pipeline_kind_for_status mirror.
describe("status-map (PL-TEST-001)", () => {
  it.each([
    ["applied", "submitted"],
    ["screening", "reviewed"],
    ["interview", "reviewed"],
    ["offer", "reviewed"],
    ["hired", "selected"],
    ["rejected", "rejected"],
    ["on_hold", "stand_by"],
  ] as const)("maps %s to %s", (kind, status) => {
    expect(statusForKind(kind)).toBe(status);
  });

  it("maps every pipeline_stage_kind to an application_status", () => {
    for (const kind of KINDS) {
      expect(STATUSES).toContain(statusForKind(kind));
    }
  });

  it("inverts every application_status, with reviewed going to screening", () => {
    for (const status of STATUSES) {
      const kind = inverseKind(status);
      expect(KINDS).toContain(kind);
      expect(statusForKind(kind)).toBe(status);
    }
    expect(inverseKind("reviewed")).toBe("screening");
  });

  it("knows which moves the candidate sees", () => {
    expect(changesCandidateStatus("screening", "interview")).toBe(false);
    expect(changesCandidateStatus("interview", "offer")).toBe(false);
    expect(changesCandidateStatus("interview", "rejected")).toBe(true);
    expect(changesCandidateStatus("applied", "screening")).toBe(true);
    expect(changesCandidateStatus(null, "applied")).toBe(true);
  });
});
