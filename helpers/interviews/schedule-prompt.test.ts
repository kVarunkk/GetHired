import { describe, expect, it } from "vitest";
import { SCHEDULE_PARAM, planItemsByStage, schedulePath, withItemFirst } from "./schedule-prompt";

describe("schedule prompt (IVT-072, D8)", () => {
  it("groups the plan's interviews by stage, in plan order", () => {
    expect(
      planItemsByStage([
        { id: "p1", name: "Tech", stage_id: "s1" },
        { id: "p2", name: "Culture", stage_id: "s2" },
        { id: "p3", name: "System design", stage_id: "s1" },
      ]),
    ).toEqual({
      s1: [
        { id: "p1", name: "Tech" },
        { id: "p3", name: "System design" },
      ],
      s2: [{ id: "p2", name: "Culture" }],
    });
  });

  it("links to the schedule page, with the plan interview when there is one", () => {
    expect(schedulePath("app1", "p3")).toBe(`/company/applications/app1/interviews/schedule?${SCHEDULE_PARAM}=p3`);
    expect(schedulePath("app1")).toBe("/company/applications/app1/interviews/schedule");
  });

  it("puts the asked-for item first, and says whether it was found", () => {
    const items = [{ id: "p1" }, { id: "p2" }, { id: "p3" }];
    expect(withItemFirst(items, "p3")).toEqual({ items: [{ id: "p3" }, { id: "p1" }, { id: "p2" }], found: true });
    expect(withItemFirst(items, "nope")).toEqual({ items, found: false });
    expect(withItemFirst(items, undefined)).toEqual({ items, found: false });
  });
});
