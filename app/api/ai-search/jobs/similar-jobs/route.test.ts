import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@/lib/supabase/server";
import { rerankSimilarJobs } from "@/helpers/jobs/rerank-jobs";
import { buildRequest } from "@/test/utils/request";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { POST } from "./route";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/helpers/jobs/rerank-jobs", () => ({ rerankSimilarJobs: vi.fn() }));

const JOBS = [{ id: "j1" }];
let supabase: SupabaseMock;

const post = (body: unknown) =>
  POST(buildRequest("/api/ai-search/jobs/similar-jobs", { method: "POST", body }));

beforeEach(() => {
  supabase = createSupabaseMock();
  vi.mocked(createClient).mockResolvedValue(supabase.client);
});

describe("POST /api/ai-search/jobs/similar-jobs", () => {
  it("re-ranks through the helper with the session client", async () => {
    vi.mocked(rerankSimilarJobs).mockResolvedValue({ rerankedJobs: ["j1"], filteredOutJobs: [] });

    const res = await post({ userId: "u1", jobId: "ref", jobs: JOBS, aiCredits: 10 });

    expect(await res.json()).toEqual({ rerankedJobs: ["j1"], filteredOutJobs: [] });
    expect(rerankSimilarJobs).toHaveBeenCalledWith(supabase.client, {
      userId: "u1",
      jobId: "ref",
      jobs: JOBS,
    });
  });

  it("returns 400 without credits", async () => {
    const res = await post({ userId: "u1", jobId: "ref", jobs: JOBS });

    expect(res.status).toBe(400);
    expect(rerankSimilarJobs).not.toHaveBeenCalled();
  });

  it("returns 404 when the reference job is missing", async () => {
    vi.mocked(rerankSimilarJobs).mockResolvedValue(null);

    const res = await post({ userId: "u1", jobId: "ref", jobs: JOBS, aiCredits: 10 });

    expect(res.status).toBe(404);
  });
});
