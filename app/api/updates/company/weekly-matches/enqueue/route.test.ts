import { beforeEach, describe, expect, it, vi } from "vitest";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendEmailForStatusUpdate } from "@/utils/email";
import { buildRequest } from "@/test/utils/request";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A, COMPANY_B } from "@/test/utils/recruiter";
import { GET } from "./route";

vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/utils/email", () => ({ sendEmail: vi.fn(), sendEmailForStatusUpdate: vi.fn() }));
vi.mock("@/utils/formatters", () => ({
  INTERNAL_API_SECRET: "test-secret",
  deploymentUrl: () => "https://gethired.test",
}));
vi.mock("server-only", () => ({}));

let db: SupabaseMock;

const run = (secret: string | null = "test-secret") =>
  GET(
    buildRequest("/api/updates/company/weekly-matches/enqueue", {
      headers: secret ? { "X-Internal-Secret": secret } : {},
    }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  db = createSupabaseMock();
  vi.mocked(createServiceRoleClient).mockReturnValue(db.client);
});

describe("GET /api/updates/company/weekly-matches/enqueue (PLT-073)", () => {
  it("401s without the secret", async () => {
    expect((await run(null)).status).toBe(401);
    expect(db.calls).toHaveLength(0);
  });

  it("queues companies that kept the email on and have an active job", async () => {
    db.queue("company_info", {
      data: [
        { id: COMPANY_A.id, job_postings: [{ id: "j1" }] },
        { id: COMPANY_B.id, job_postings: [{ id: "j2" }] },
      ],
      error: null,
    });

    expect(await (await run()).json()).toEqual({ success: true, queued: 2 });

    const [query] = db.callsFor("company_info");
    expect(query.chain).toContainEqual({ method: "eq", args: ["notify_weekly_matches", true] });
    expect(query.chain).toContainEqual({ method: "eq", args: ["job_postings.status", "active"] });
    expect(db.callsFor("send_batch")[0].chain[0].args[1]).toEqual({
      queue_name: "weekly_matches_queue",
      messages: [{ companyId: COMPANY_A.id }, { companyId: COMPANY_B.id }],
      sleep_seconds: 0,
    });
  });

  it("500s and reports when the query fails", async () => {
    db.queue("company_info", { data: null, error: { message: "boom" } });

    expect((await run()).status).toBe(500);
    expect(sendEmailForStatusUpdate).toHaveBeenCalledWith(expect.stringContaining("boom"));
  });
});
