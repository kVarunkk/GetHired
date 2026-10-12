import { beforeEach, describe, expect, it, vi } from "vitest";
import { createProfileTools } from "./profile";
import { execTool, toolContext, validateInput } from "@/test/utils/tools";
import { flushAfter } from "@/test/utils/after";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { getProfile } from "@/helpers/user/get-profile";
import { updateUserEmbedding } from "@/helpers/user/update-user-embedding";
import { canonicalizeLocations } from "@/helpers/locations/aliases";

vi.mock("@/helpers/user/get-profile", () => ({ getProfile: vi.fn() }));
vi.mock("@/helpers/user/update-user-embedding", () => ({ updateUserEmbedding: vi.fn() }));
vi.mock("@/helpers/locations/aliases", () => ({ canonicalizeLocations: vi.fn() }));
vi.mock("@/helpers/posthog/EventCaptureServerException", () => ({
  eventCaptureServerException: vi.fn(),
}));

let supabase: SupabaseMock;
let tools: ReturnType<typeof createProfileTools>;

beforeEach(() => {
  supabase = createSupabaseMock();
  tools = createProfileTools(toolContext(supabase.client));
  vi.mocked(canonicalizeLocations).mockImplementation(async (names) => names);
});

describe("getMyProfile tool", () => {
  it("returns the profile summary for the ctx user", async () => {
    vi.mocked(getProfile).mockResolvedValue({ user_id: "u1", ai_credits: 3 } as never);

    expect(await execTool(tools.getMyProfile, {})).toEqual({ user_id: "u1", ai_credits: 3 });
    expect(getProfile).toHaveBeenCalledWith(
      supabase.client,
      expect.objectContaining({ id: "u1", email: "ada@example.com" }),
    );
  });

  it("never throws", async () => {
    vi.mocked(getProfile).mockRejectedValue(new Error("db down"));

    expect(await execTool(tools.getMyProfile, {})).toEqual({
      error: "Something went wrong while running getMyProfile. Please try again.",
    });
  });
});

describe("updateMyPreferences tool", () => {
  it("maps fields to user_info columns and refreshes the embedding after responding", async () => {
    supabase.queue("user_info", { data: [{ user_id: "u1" }], error: null });

    const result = await execTool(tools.updateMyPreferences, {
      desiredRoles: ["Backend Engineer"],
      preferredLocations: ["Remote"],
      minSalary: 100000,
      maxSalary: 150000,
      salaryCurrency: "$",
      jobTypes: ["Fulltime"],
      visaSponsorshipRequired: true,
      topSkills: ["Go", "Postgres"],
      workStylePreferences: ["Remote", "Fast-paced"],
    });

    expect(supabase.callsFor("user_info")[0].chain).toEqual([
      {
        method: "update",
        args: [
          {
            desired_roles: ["Backend Engineer"],
            preferred_locations: ["Remote"],
            min_salary: 100000,
            max_salary: 150000,
            salary_currency: "$",
            job_type: ["Fulltime"],
            visa_sponsorship_required: true,
            top_skills: ["Go", "Postgres"],
            work_style_preferences: ["Remote", "Fast-paced"],
          },
        ],
      },
      { method: "eq", args: ["user_id", "u1"] },
      { method: "select", args: ["user_id"] },
    ]);
    expect(result).toEqual({
      updated: [
        "desiredRoles",
        "preferredLocations",
        "minSalary",
        "maxSalary",
        "salaryCurrency",
        "jobTypes",
        "visaSponsorshipRequired",
        "topSkills",
        "workStylePreferences",
      ],
      preferredLocations: ["Remote"],
    });
    expect(updateUserEmbedding).not.toHaveBeenCalled();
    await flushAfter();
    expect(updateUserEmbedding).toHaveBeenCalledWith("u1");
  });

  it("saves canonical location names and reports them (REQ-023)", async () => {
    supabase.queue("user_info", { data: [{ user_id: "u1" }], error: null });
    vi.mocked(canonicalizeLocations).mockResolvedValue(["Bengaluru", "Remote"]);

    const result = await execTool(tools.updateMyPreferences, {
      preferredLocations: ["Bangalore", "Remote"],
    });

    expect(canonicalizeLocations).toHaveBeenCalledWith(["Bangalore", "Remote"]);
    expect(supabase.callsFor("user_info")[0].chain[0].args[0]).toEqual({
      preferred_locations: ["Bengaluru", "Remote"],
    });
    expect(result).toEqual({
      updated: ["preferredLocations"],
      preferredLocations: ["Bengaluru", "Remote"],
    });
  });

  it("only updates the given fields", async () => {
    supabase.queue("user_info", { data: [{ user_id: "u1" }], error: null });

    const result = await execTool(tools.updateMyPreferences, { desiredRoles: ["Backend Engineer"] });

    expect(supabase.callsFor("user_info")[0].chain[0].args[0]).toEqual({
      desired_roles: ["Backend Engineer"],
    });
    expect(result).toEqual({ updated: ["desiredRoles"] });
    expect(canonicalizeLocations).not.toHaveBeenCalled();
  });

  it("returns an error when the user has no profile", async () => {
    supabase.queue("user_info", { data: [], error: null });

    expect(await execTool(tools.updateMyPreferences, { topSkills: ["Go"] })).toEqual({
      error: "Profile not found. Ask the user to complete onboarding at /get-started.",
    });
    await flushAfter();
    expect(updateUserEmbedding).not.toHaveBeenCalled();
  });

  it.each([
    ["no fields", {}],
    ["min salary above max", { minSalary: 200, maxSalary: 100 }],
    ["an unknown currency", { salaryCurrency: "BTC" }],
    ["an unknown job type", { jobTypes: ["Parttime"] }],
    ["a userId", { userId: "someone-else", topSkills: ["Go"] }],
  ])("rejects %s", async (_label, input) => {
    expect((await validateInput(tools.updateMyPreferences, input)).success).toBe(false);
  });
});
