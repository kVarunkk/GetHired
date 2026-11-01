import { describe, expect, it } from "vitest";
import { matchStages, stageMapOf, stageValues } from "./stage-map";

const APPLIED = "90000000-0000-4000-8000-000000000001";
const ONSITE = "90000000-0000-4000-8000-000000000002";
const OFFER = "90000000-0000-4000-8000-000000000003";
const STAGES = [
  { id: APPLIED, name: "Applied" },
  { id: ONSITE, name: "Onsite" },
  { id: OFFER, name: "Offer" },
];

describe("stageValues", () => {
  it("lists the distinct values in order, ignoring case and blanks", () => {
    expect(stageValues([{ stage: "Onsite" }, { stage: " onsite " }, { stage: "" }, {}, { stage: "Phone screen" }])).toEqual([
      "Onsite",
      "Phone screen",
    ]);
  });
});

describe("matchStages (BI-REQ-015a)", () => {
  it("preselects stages by name, and leaves the rest to the destination stage", () => {
    expect(matchStages(["onsite ", "OFFER", "Phone screen"], STAGES)).toEqual({
      "onsite ": ONSITE,
      OFFER: OFFER,
      "Phone screen": null,
    });
  });

  it("prefers a saved choice, when that stage is still open", () => {
    const gone = "90000000-0000-4000-8000-0000000000ff";
    expect(matchStages(["Phone screen", "Onsite"], STAGES, { "phone screen": APPLIED, Onsite: gone })).toEqual({
      "Phone screen": APPLIED,
      Onsite: ONSITE,
    });
  });
});

describe("stageMapOf", () => {
  it("keeps only values with a stage of their own", () => {
    expect(stageMapOf({ Onsite: ONSITE, "Phone screen": null })).toEqual({ Onsite: ONSITE });
    expect(stageMapOf({ "Phone screen": null })).toBeUndefined();
  });
});
