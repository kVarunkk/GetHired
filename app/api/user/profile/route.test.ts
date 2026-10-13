/**
 * Characterisation tests for GET /api/user/profile (TASK-024).
 * They pin the route's current behaviour so the extraction into
 * helpers/user/get-profile.ts can be checked for regressions.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { mockUser, setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";

vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

let supabase: SupabaseMock;

const USER_INFO = {
  full_name: "Ada Lovelace",
  email: "ada@example.com",
  ai_credits: 42,
  updated_at: "2026-10-01T00:00:00.000Z",
  filled: true,
  invitations_count: 2,
};

beforeEach(async () => {
  supabase = createSupabaseMock();
  await setRequestUser(mockUser({ id: "u1", email: "ada@example.com" }), supabase.client);
});

describe("GET /api/user/profile", () => {
  it("returns 401 without a user", async () => {
    await setRequestUser(null);

    const res = await GET();

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("returns the profile, weekly metrics and recent applications", async () => {
    supabase.queue("user_info", { data: USER_INFO, error: null });
    supabase.queueRpc("get_applicant_weekly_metrics", {
      data: [{ applications_this_week: 3 }],
      error: null,
    });
    supabase.queue("applications", {
      data: [
        {
          status: "reviewed",
          created_at: "2026-10-10T00:00:00.000Z",
          all_jobs: { id: "j1", job_name: "Engineer", company_name: "Acme", platform: "lever", locations: ["Remote"] },
        },
      ],
      error: null,
    });

    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: {
        user_id: "u1",
        email: "ada@example.com",
        full_name: "Ada Lovelace",
        ai_credits: 42,
        onboarding_complete: true,
        invitations_count: 2,
        metrics: { applications_this_week: 3 },
        recent_applications: [
          {
            id: "j1",
            job_name: "Engineer",
            company_name: "Acme",
            platform: "lever",
            locations: ["Remote"],
            status: "reviewed",
            applied_at: "2026-10-10T00:00:00.000Z",
          },
        ],
      },
    });
  });

  it("queries the user's own rows", async () => {
    supabase.queue("user_info", { data: USER_INFO, error: null });

    await GET();

    expect(supabase.callsFor("user_info")[0].chain).toEqual([
      { method: "select", args: ["full_name, email, ai_credits, updated_at, filled, invitations_count"] },
      { method: "eq", args: ["user_id", "u1"] },
      { method: "single", args: [] },
    ]);
    expect(supabase.callsFor("get_applicant_weekly_metrics")[0].chain).toEqual([
      { method: "rpc", args: ["get_applicant_weekly_metrics", { p_user_id: "u1" }] },
    ]);
    expect(supabase.callsFor("applications")[0].chain).toEqual([
      {
        method: "select",
        args: ["status, created_at, all_jobs!inner(id, job_name, company_name, platform, locations)"],
      },
      { method: "eq", args: ["applicant_user_id", "u1"] },
      { method: "order", args: ["created_at", { ascending: false }] },
      { method: "limit", args: [3] },
    ]);
  });

  it("defaults metrics to {} and applications to [] when empty", async () => {
    supabase.queue("user_info", { data: USER_INFO, error: null });

    const res = await GET();
    const { data } = await res.json();

    expect(data.metrics).toEqual({});
    expect(data.recent_applications).toEqual([]);
  });

  it("returns 500 with the message when user_info fails", async () => {
    supabase.queue("user_info", { data: null, error: new Error("no profile") });

    const res = await GET();

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "no profile" });
  });

  it("returns 500 when the metrics rpc fails", async () => {
    supabase.queue("user_info", { data: USER_INFO, error: null });
    supabase.queueRpc("get_applicant_weekly_metrics", { data: null, error: new Error("rpc down") });

    const res = await GET();

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "rpc down" });
  });

  it("uses a generic message for non-Error failures", async () => {
    supabase.queue("user_info", { data: null, error: { message: "plain object" } });

    const res = await GET();

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "An unexpected error occurred" });
  });
});
