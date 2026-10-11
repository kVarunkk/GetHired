import { describe, expect, it, vi } from "vitest";
import { compactJob, INSUFFICIENT_CREDITS, withToolErrors } from "./shared";
import { toolContext } from "@/test/utils/tools";
import { createSupabaseMock } from "@/test/utils/supabase-mock";
import { eventCaptureServerException } from "@/helpers/posthog/EventCaptureServerException";

vi.mock("@/helpers/posthog/EventCaptureServerException", () => ({
  eventCaptureServerException: vi.fn(),
}));

describe("compactJob", () => {
  it("keeps only what the model needs and adds the job page url", () => {
    const fullRow = {
      id: "j1",
      job_name: "Frontend Engineer",
      company_name: "Acme",
      locations: ["Remote"],
      salary_range: "$100k - $140k",
      job_type: "Fulltime",
      created_at: "2026-10-01T00:00:00.000Z",
      description: "very long text",
      ai_summary: "summary",
    };

    expect(compactJob(fullRow)).toEqual({
      id: "j1",
      title: "Frontend Engineer",
      company: "Acme",
      locations: ["Remote"],
      salary: "$100k - $140k",
      jobType: "Fulltime",
      postedAt: "2026-10-01T00:00:00.000Z",
      url: "/jobs/j1",
    });
  });

  it("uses null for missing fields", () => {
    expect(compactJob({ id: "j2" })).toMatchObject({
      title: null,
      company: null,
      locations: [],
      salary: null,
    });
  });
});

describe("INSUFFICIENT_CREDITS", () => {
  it("points the user to the recharge page", () => {
    expect(INSUFFICIENT_CREDITS).toEqual({
      error: "INSUFFICIENT_CREDITS",
      message: "Not enough AI credits for this action.",
      rechargeUrl: "/dashboard/buy-credits",
    });
  });
});

describe("withToolErrors", () => {
  const ctx = toolContext(createSupabaseMock().client);

  it("returns the function's result", async () => {
    expect(
      await withToolErrors(ctx, "searchJobs", async () => ({ jobs: [] })),
    ).toEqual({
      jobs: [],
    });
  });

  it("turns thrown errors into a generic tool error and reports them", async () => {
    const error = new Error("relation does not exist: secret_table");

    const result = await withToolErrors(ctx, "searchJobs", async () => {
      throw error;
    });

    expect(result).toEqual({
      error: "Something went wrong while running searchJobs. Please try again.",
    });
    expect(JSON.stringify(result)).not.toContain("secret_table");
    expect(eventCaptureServerException).toHaveBeenCalledWith({
      error,
      distinctId: "u1",
      properties: { flow: "agent_tool", tool: "searchJobs", session_id: "s1" },
    });
  });
});
