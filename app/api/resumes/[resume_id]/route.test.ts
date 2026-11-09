import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { buildRequest } from "@/test/utils/request";
import { mockUser, setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/helpers/posthog/report-error", () => ({ reportError: vi.fn() }));

const RESUME_ID = "22222222-2222-4222-8222-222222222222";
const USER = mockUser({ id: "u1" });
const RESUME = {
  id: RESUME_ID,
  name: "CV",
  content: { sections: [] },
  created_at: "c",
  updated_at: "u",
  is_primary: true,
};

let supabase: SupabaseMock;

const get = (resumeId = RESUME_ID) =>
  GET(buildRequest(`/api/resumes/${resumeId}`), {
    params: Promise.resolve({ resume_id: resumeId }),
  });

beforeEach(async () => {
  supabase = createSupabaseMock({ user: USER });
  await setRequestUser(USER, supabase.client);
});

describe("GET /api/resumes/[resume_id]", () => {
  it("returns 401 without a user", async () => {
    await setRequestUser(null, supabase.client);

    const res = await get();

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("returns the user's own resume", async () => {
    supabase.queue("resumes", { data: RESUME, error: null });

    const res = await get();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: RESUME });
    expect(supabase.callsFor("resumes")[0].chain).toEqual([
      {
        method: "select",
        args: ["id, name, content, contact, template, revision, schema_version, resume_path, created_at, updated_at, is_primary"],
      },
      { method: "eq", args: ["user_id", "u1"] },
      { method: "eq", args: ["id", RESUME_ID] },
      { method: "maybeSingle", args: [] },
    ]);
  });

  it("returns 404 for a resume the user doesn't have", async () => {
    const res = await get();

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Resume not found." });
  });

  it("returns 500 on a database error", async () => {
    supabase.queue("resumes", { data: null, error: new Error("boom") });

    const res = await get();

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "An error occurred while fetching resume details." });
  });
});
