import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { rerankJobsForUser } from "@/helpers/jobs/rerank-jobs";
import { buildRequest } from "@/test/utils/request";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { POST } from "./route";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/helpers/jobs/rerank-jobs", () => ({ rerankJobsForUser: vi.fn() }));

const JOBS = [{ id: "j1" }];
let supabase: SupabaseMock;
let service: SupabaseMock;

const post = (body: unknown, headers?: Record<string, string>) =>
  POST(buildRequest("/api/ai-search/jobs", { method: "POST", body, headers }));

beforeEach(() => {
  vi.stubEnv("INTERNAL_API_SECRET", "secret");
  supabase = createSupabaseMock();
  service = createSupabaseMock();
  vi.mocked(createClient).mockResolvedValue(supabase.client);
  vi.mocked(createServiceRoleClient).mockReturnValue(service.client);
});

describe("POST /api/ai-search/jobs", () => {
  it("re-ranks through the helper with the session client", async () => {
    vi.mocked(rerankJobsForUser).mockResolvedValue({ rerankedJobs: ["j1"], filteredOutJobs: [] });

    const res = await post({ userId: "u1", jobs: JOBS, type: "job_digest" });

    expect(await res.json()).toEqual({ rerankedJobs: ["j1"], filteredOutJobs: [] });
    expect(rerankJobsForUser).toHaveBeenCalledWith(supabase.client, {
      userId: "u1",
      jobs: JOBS,
      type: "job_digest",
    });
  });

  it("uses the service role on internal calls", async () => {
    vi.mocked(rerankJobsForUser).mockResolvedValue({ rerankedJobs: [], filteredOutJobs: [] });

    await post({ userId: "u1", jobs: JOBS, type: "job_digest" }, { "X-Internal-Secret": "secret" });

    expect(rerankJobsForUser).toHaveBeenCalledWith(service.client, expect.anything());
  });

  it("returns 400 without a user or jobs", async () => {
    const res = await post({ jobs: JOBS });

    expect(res.status).toBe(400);
    expect(rerankJobsForUser).not.toHaveBeenCalled();
  });

  it("returns 404 when the profile is missing", async () => {
    vi.mocked(rerankJobsForUser).mockResolvedValue(null);

    const res = await post({ userId: "u1", jobs: JOBS, type: "job_digest" });

    expect(res.status).toBe(404);
  });

  it("answers a failure with a generic message and no ranking", async () => {
    vi.mocked(rerankJobsForUser).mockRejectedValue(new Error("jev down"));

    const res = await post({ userId: "u1", jobs: JOBS, type: "job_digest" });

    expect(await res.json()).toEqual({ message: "An error occurred" });
  });
});
