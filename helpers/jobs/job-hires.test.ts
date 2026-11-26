import { beforeEach, describe, expect, it } from "vitest";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { countJobHires, fillSuggestions, hiresLabel, shouldSuggestFill } from "./job-hires";

const J1 = "b0000000-0000-4000-8000-000000000001";
const J2 = "b0000000-0000-4000-8000-000000000002";

let db: SupabaseMock;
beforeEach(() => {
  db = createSupabaseMock();
});

describe("countJobHires (JL-REQ-012)", () => {
  it("counts non-merged applications in a hired-kind stage, per job", async () => {
    db.queue("applications", {
      data: [{ job_post_id: J1 }, { job_post_id: J1 }, { job_post_id: J2 }],
      error: null,
    });

    const counts = await countJobHires(db.client, [J1, J2]);
    expect(Object.fromEntries(counts)).toEqual({ [J1]: 2, [J2]: 1 });

    const chain = db.callsFor("applications")[0].chain;
    expect(chain).toContainEqual({ method: "select", args: ["job_post_id, pipeline_stages!inner(kind)"] });
    expect(chain).toContainEqual({ method: "is", args: ["merged_into_application_id", null] });
    expect(chain).toContainEqual({ method: "eq", args: ["pipeline_stages.kind", "hired"] });
    expect(chain).toContainEqual({ method: "in", args: ["job_post_id", [J1, J2]] });
  });

  it("asks nothing for no jobs", async () => {
    expect((await countJobHires(db.client, [])).size).toBe(0);
    expect(db.calls).toHaveLength(0);
  });
});

describe("shouldSuggestFill (D5)", () => {
  it("only for open or paused jobs whose hires reached the openings", () => {
    expect(shouldSuggestFill({ state: "open", openings: 2 }, 2)).toBe(true);
    expect(shouldSuggestFill({ state: "paused", openings: 2 }, 3)).toBe(true);
    expect(shouldSuggestFill({ state: "open", openings: 2 }, 1)).toBe(false);
    for (const state of ["draft", "pending_approval", "closed", "filled"] as const) {
      expect(shouldSuggestFill({ state, openings: 1 }, 5)).toBe(false);
    }
  });

  it("labels the count", () => {
    expect(hiresLabel(1, 3)).toBe("Hired 1 of 3");
  });
});

describe("fillSuggestions (JL-REQ-013)", () => {
  it("suggests a job whose hires just reached its openings", async () => {
    db.queue("job_postings", { data: [{ id: J1, title: "Engineer", state: "open", openings: 2 }], error: null });
    db.queue("applications", { data: [{ job_post_id: J1 }, { job_post_id: J1 }], error: null });

    expect(await fillSuggestions(db.client, [{ jobPostId: J1, fromKind: "offer" }])).toEqual([
      { jobPostId: J1, title: "Engineer", hires: 2, openings: 2 },
    ]);
  });

  it("doesn't suggest again once the job was already at its openings", async () => {
    db.queue("job_postings", { data: [{ id: J1, title: "Engineer", state: "open", openings: 1 }], error: null });
    db.queue("applications", { data: [{ job_post_id: J1 }, { job_post_id: J1 }], error: null });

    expect(await fillSuggestions(db.client, [{ jobPostId: J1, fromKind: "offer" }])).toEqual([]);
  });

  it("ignores jobs below their openings and closed jobs", async () => {
    db.queue("job_postings", {
      data: [
        { id: J1, title: "Engineer", state: "open", openings: 3 },
        { id: J2, title: "Designer", state: "closed", openings: 1 },
      ],
      error: null,
    });
    db.queue("applications", { data: [{ job_post_id: J1 }, { job_post_id: J2 }], error: null });

    expect(
      await fillSuggestions(db.client, [
        { jobPostId: J1, fromKind: "offer" },
        { jobPostId: J2, fromKind: "offer" },
      ]),
    ).toEqual([]);
  });

  it("skips moves from one hired stage to another", async () => {
    expect(await fillSuggestions(db.client, [{ jobPostId: J1, fromKind: "hired" }])).toEqual([]);
    expect(db.calls).toHaveLength(0);
  });
});
