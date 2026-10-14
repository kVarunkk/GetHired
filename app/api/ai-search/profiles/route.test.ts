import { beforeEach, describe, expect, it, vi } from "vitest";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { rerankWithJev } from "@/utils/rerank-jev";
import { buildRequest } from "@/test/utils/request";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A } from "@/test/utils/recruiter";
import { JOB_POST } from "@/test/utils/matching";
import { POST } from "./route";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/utils/rerank-jev", () => ({ rerankWithJev: vi.fn() }));

const SECRET = "internal-secret";
let supabase: SupabaseMock;

beforeEach(() => {
  vi.stubEnv("INTERNAL_API_SECRET", SECRET);
  supabase = createSupabaseMock();
  vi.mocked(createServiceRoleClient).mockReturnValue(supabase.client);
});

const post = (body: unknown) =>
  POST(
    buildRequest("/api/ai-search/profiles", {
      method: "POST",
      body,
      headers: { "X-Internal-Secret": SECRET },
    }),
  );

describe("POST /api/ai-search/profiles", () => {
  it("returns the rerank's scores alongside the order (MT-TASK-001)", async () => {
    supabase.queue("job_postings", { data: JOB_POST, error: null });
    const scores = { u1: { skills: 3, experience: 2, preferenceConflict: 0.1, aggregate: 2.6 } };
    vi.mocked(rerankWithJev).mockResolvedValue({
      reranked_job_ids: ["u1"],
      filtered_out_ids: ["u2"],
      scores,
    });

    const res = await post({
      userId: COMPANY_A.user.id,
      jobId: JOB_POST.id,
      companyId: COMPANY_A.id,
      profiles: [{ user_id: "u1" }, { user_id: "u2" }],
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      rerankedProfiles: ["u1"],
      filteredOutProfiles: ["u2"],
      scores,
    });
  });

  it("returns an empty scores object when the rerank has none", async () => {
    supabase.queue("job_postings", { data: JOB_POST, error: null });
    vi.mocked(rerankWithJev).mockResolvedValue({ reranked_job_ids: [], filtered_out_ids: [] });

    const res = await post({
      userId: COMPANY_A.user.id,
      jobId: JOB_POST.id,
      companyId: COMPANY_A.id,
      profiles: [],
    });

    expect((await res.json()).scores).toEqual({});
  });
});
