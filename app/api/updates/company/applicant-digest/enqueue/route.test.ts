import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

const WATERMARK = "2026-10-14T03:30:00.000Z";
let db: SupabaseMock;

const run = (secret: string | null = "test-secret") =>
  GET(
    buildRequest("/api/updates/company/applicant-digest/enqueue", {
      headers: secret ? { "X-Internal-Secret": secret } : {},
    }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  db = createSupabaseMock();
  vi.mocked(createServiceRoleClient).mockReturnValue(db.client);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-15T03:30:00.000Z"));
});
afterEach(() => vi.useRealTimers());

describe("GET /api/updates/company/applicant-digest/enqueue (PLT-071, PL-TEST-007)", () => {
  it.each([
    ["a missing", null],
    ["a wrong", "nope"],
  ])("401s with %s secret", async (_label, secret) => {
    expect((await run(secret)).status).toBe(401);
    expect(db.calls).toHaveLength(0);
  });

  it("queues only daily companies with applications since their last digest", async () => {
    db.queue("company_info", {
      data: [
        { id: COMPANY_A.id, last_applicant_digest_at: WATERMARK },
        { id: COMPANY_B.id, last_applicant_digest_at: null },
      ],
      error: null,
    });
    db.queue("applications", { data: [{ id: "a1" }], error: null });
    db.queue("applications", { data: [], error: null });

    expect(await (await run()).json()).toEqual({ success: true, queued: 1 });

    const [companies] = db.callsFor("company_info");
    expect(companies.chain).toContainEqual({ method: "eq", args: ["notify_new_applicants", "daily"] });
    const [a, b] = db.callsFor("applications");
    expect(a.chain).toContainEqual({ method: "gt", args: ["created_at", WATERMARK] });
    // A company that never had a digest looks back a day.
    expect(b.chain).toContainEqual({ method: "gt", args: ["created_at", "2026-10-14T03:30:00.000Z"] });
    expect(db.callsFor("send_batch")[0].chain[0].args[1]).toEqual({
      queue_name: "applicant_digest_queue",
      messages: [{ companyId: COMPANY_A.id }],
      sleep_seconds: 0,
    });
  });

  it("queues nothing when no company has new applications", async () => {
    db.queue("company_info", { data: [{ id: COMPANY_A.id, last_applicant_digest_at: WATERMARK }], error: null });
    db.queue("applications", { data: [], error: null });

    expect(await (await run()).json()).toEqual({ success: true, queued: 0 });
    expect(db.callsFor("send_batch")).toHaveLength(0);
  });

  it("500s and reports when a query fails", async () => {
    db.queue("company_info", { data: null, error: { message: "boom" } });

    expect((await run()).status).toBe(500);
    expect(sendEmailForStatusUpdate).toHaveBeenCalledWith(expect.stringContaining("boom"));
  });
});
