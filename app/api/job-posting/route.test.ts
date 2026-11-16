import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@/lib/supabase/server";
import { buildRequest } from "@/test/utils/request";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { GET } from "./route";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const JOB = "b0000000-0000-4000-8000-000000000001";

let db: SupabaseMock;

beforeEach(() => {
  vi.clearAllMocks();
  db = createSupabaseMock({ user: { id: "u1" } });
  vi.mocked(createClient).mockResolvedValue(db.client);
});

describe("GET /api/job-posting (JPT-043)", () => {
  it("returns the job without its pipeline (JP-SEC-003)", async () => {
    db.queue("job_postings", {
      data: [{ id: JOB, title: "Backend Engineer", pipeline_id: "9e000000-0000-4000-8000-000000000001" }],
      error: null,
    });

    const res = await GET(buildRequest(`/api/job-posting?jobId=${JOB}`));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual({ id: JOB, title: "Backend Engineer" });
    expect(body.data).not.toHaveProperty("pipeline_id");
  });

  it("still needs a signed-in user", async () => {
    db = createSupabaseMock({ user: null });
    vi.mocked(createClient).mockResolvedValue(db.client);

    const res = await GET(buildRequest(`/api/job-posting?jobId=${JOB}`));

    expect(res.status).toBe(401);
  });
});
