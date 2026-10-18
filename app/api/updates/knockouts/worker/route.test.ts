import { beforeEach, describe, expect, it, vi } from "vitest";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendCompanyMessage } from "@/helpers/email/send-company-message";
import { buildRequest } from "@/test/utils/request";
import { createSupabaseMock, type RecordedCall, type SupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A, PUBLIC_APPLICANT } from "@/test/utils/recruiter";
import { GET } from "./route";

vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/helpers/email/send-company-message", () => ({ sendCompanyMessage: vi.fn() }));
vi.mock("@/utils/formatters", () => ({ INTERNAL_API_SECRET: "test-secret" }));
vi.mock("server-only", () => ({}));

const APP_ID = "e0000000-0000-4000-8000-0000000000aa";
const TEMPLATE = { id: "7e000000-0000-4000-8000-000000000001", subject: "Your {{job_title}} application", body_md: "Hi {{candidate_first_name}}, thanks for applying." };

let db: SupabaseMock;

const call = () => GET(buildRequest("/api/updates/knockouts/worker", { headers: { "X-Internal-Secret": "test-secret" } }));
const updates = (table: string) =>
  db.callsFor(table).filter((c: RecordedCall) => c.chain.some((m) => m.method === "update")).map((c) => c.chain.find((m) => m.method === "update")!.args[0]);

function queueDue({ kind = "rejected", template = TEMPLATE as unknown }: { kind?: string; template?: unknown } = {}) {
  db.queue("application_knockouts", { data: [{ application_id: APP_ID, company_id: COMPANY_A.id }], error: null });
  db.queue("applications", {
    data: {
      id: APP_ID,
      applicant_user_id: PUBLIC_APPLICANT.id,
      pipeline_stages: { kind },
      user_info: { email: "ada@example.com", full_name: "Ada Lovelace" },
      job_postings: { title: "Frontend Engineer" },
    },
    error: null,
  });
  db.queue("company_email_templates", { data: template, error: null });
  db.queue("company_info", { data: { name: "Acme", email: "hr@acme.test", logo_url: null, scheduling_url: null }, error: null });
  db.queue("application_knockouts", { data: null, error: null });
  db.queue("application_events", { data: null, error: null });
}

beforeEach(() => {
  vi.clearAllMocks();
  db = createSupabaseMock();
  vi.mocked(createServiceRoleClient).mockReturnValue(db.client);
  vi.mocked(sendCompanyMessage).mockResolvedValue({ ok: true });
});

describe("GET /api/updates/knockouts/worker (AF-DEC-002, CPT-032)", () => {
  it("needs the internal secret", async () => {
    const res = await GET(buildRequest("/api/updates/knockouts/worker"));
    expect(res.status).toBe(401);
    expect(db.calls).toHaveLength(0);
  });

  it("reads only due, unsent rows", async () => {
    db.queue("application_knockouts", { data: [], error: null });
    await call();
    const chain = db.callsFor("application_knockouts")[0].chain;
    expect(chain.find((m) => m.method === "lte")?.args[0]).toBe("reject_email_due_at");
    expect(chain).toContainEqual({ method: "is", args: ["reject_email_sent_at", null] });
  });

  it("sends the company's rejection template once and marks it sent", async () => {
    queueDue();

    const res = await call();

    expect(await res.json()).toEqual({ sent: 1, cancelled: 0, failed: 0 });
    expect(sendCompanyMessage).toHaveBeenCalledWith({
      toEmail: "ada@example.com",
      subject: "Your Frontend Engineer application",
      bodyMd: "Hi Ada, thanks for applying.",
      companyName: "Acme",
      companyEmail: "hr@acme.test",
      logoUrl: null,
    });
    expect(updates("application_knockouts")).toEqual([{ reject_email_sent_at: expect.any(String) }]);
    expect(db.callsFor("application_events")[0].chain[0].args[0]).toMatchObject({ type: "email_sent", actor_user_id: null });
  });

  it("cancels the email when the application left Rejected", async () => {
    queueDue({ kind: "interview" });

    expect(await (await call()).json()).toEqual({ sent: 0, cancelled: 1, failed: 0 });
    expect(sendCompanyMessage).not.toHaveBeenCalled();
    expect(updates("application_knockouts")).toEqual([{ reject_email_due_at: null }]);
  });

  it("cancels when the company has no rejection template", async () => {
    queueDue({ template: null });
    expect(await (await call()).json()).toEqual({ sent: 0, cancelled: 1, failed: 0 });
  });

  it("leaves a failed send for the next run", async () => {
    vi.mocked(sendCompanyMessage).mockResolvedValue({ ok: false, error: "down" });
    queueDue();

    expect(await (await call()).json()).toEqual({ sent: 0, cancelled: 0, failed: 1 });
    expect(updates("application_knockouts")).toEqual([]);
  });
});
