import { beforeEach, describe, expect, it, vi } from "vitest";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendCompanyMessage } from "@/helpers/email/send-company-message";
import { PIPELINE_EMAIL_MAX_READS, type PipelineEmailMessage } from "@/helpers/pipeline/email-queue";
import { sendEmailForStatusUpdate } from "@/utils/email";
import { buildRequest } from "@/test/utils/request";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A, COMPANY_B } from "@/test/utils/recruiter";
import { GET } from "./route";

vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/helpers/email/send-company-message", () => ({ sendCompanyMessage: vi.fn() }));
vi.mock("@/utils/email", () => ({ sendEmailForStatusUpdate: vi.fn() }));
vi.mock("@/utils/formatters", () => ({ INTERNAL_API_SECRET: "test-secret" }));
vi.mock("server-only", () => ({}));

const appId = (n: number) => `e0000000-0000-4000-8000-00000000000${n}`;
const TEMPLATE_ID = "c0000000-0000-4000-8000-000000000001";

let db: SupabaseMock;

const payload = (n: number): PipelineEmailMessage => ({
  applicationId: appId(n),
  companyId: COMPANY_A.id,
  candidateUserId: `candidate-${n}`,
  actorUserId: COMPANY_A.user.id,
  actorName: "Asha",
  templateId: TEMPLATE_ID,
  subject: `Next steps ${n}`,
  body: `Hi candidate ${n}`,
  companyName: "Acme",
  companyEmail: "hr@acme.dev",
  logoUrl: null,
});
const message = (msg_id: number, n: number, read_ct = 1) => ({ msg_id, read_ct, message: payload(n) });
const appRow = (n: number, { email = `c${n}@example.com`, companyId = COMPANY_A.id } = {}) => ({
  id: appId(n),
  user_info: { email },
  job_postings: { company_id: companyId },
});

const run = () =>
  GET(buildRequest("/api/worker/pipeline-emails", { headers: { "X-Internal-Secret": "test-secret" } }));

const archived = () =>
  db.callsFor("archive").map((c) => (c.chain[0].args[1] as { message_id: number }).message_id);
const insertedEvents = () =>
  db
    .callsFor("application_events")
    .flatMap((c) => c.chain.find((m) => m.method === "insert")?.args[0] as Record<string, unknown>[]);

beforeEach(() => {
  vi.clearAllMocks();
  db = createSupabaseMock();
  vi.mocked(createServiceRoleClient).mockReturnValue(db.client);
  vi.mocked(sendCompanyMessage).mockResolvedValue({ ok: true });
});

describe("GET /api/worker/pipeline-emails", () => {
  it("401s without the secret", async () => {
    const res = await GET(buildRequest("/api/worker/pipeline-emails"));

    expect(res.status).toBe(401);
    expect(db.calls).toHaveLength(0);
  });

  it("does nothing on an empty queue", async () => {
    db.queueRpc("read", { data: [], error: null }, "pgmq_public");

    expect(await (await run()).json()).toEqual({ sent: 0, dropped: 0, failed: 0 });
    expect(db.callsFor("applications")).toHaveLength(0);
  });

  it("sends to the address in the DB, logs email_sent with the mover and archives", async () => {
    db.queueRpc("read", { data: [message(7, 1), message(8, 2)], error: null }, "pgmq_public");
    db.queue("applications", { data: [appRow(1), appRow(2)], error: null });

    expect(await (await run()).json()).toEqual({ sent: 2, dropped: 0, failed: 0 });

    expect(sendCompanyMessage).toHaveBeenCalledWith({
      toEmail: "c1@example.com",
      subject: "Next steps 1",
      bodyMd: "Hi candidate 1",
      companyName: "Acme",
      companyEmail: "hr@acme.dev",
      logoUrl: null,
    });
    expect(insertedEvents()).toEqual([1, 2].map((n) => ({
      company_id: COMPANY_A.id,
      application_id: appId(n),
      candidate_user_id: `candidate-${n}`,
      actor_user_id: COMPANY_A.user.id,
      actor_name: "Asha",
      type: "email_sent",
      payload: { template_id: TEMPLATE_ID, subject: `Next steps ${n}` },
    })));
    // Never the body.
    expect(JSON.stringify(insertedEvents())).not.toContain("Hi candidate");
    expect(archived().sort()).toEqual([7, 8]);
  });

  it("drops applications that are gone, on another company's job or have no address", async () => {
    db.queueRpc("read", { data: [message(1, 1), message(2, 2), message(3, 3)], error: null }, "pgmq_public");
    db.queue("applications", {
      data: [appRow(2, { companyId: COMPANY_B.id }), appRow(3, { email: null as unknown as string })],
      error: null,
    });

    expect(await (await run()).json()).toEqual({ sent: 0, dropped: 3, failed: 0 });

    expect(sendCompanyMessage).not.toHaveBeenCalled();
    expect(db.callsFor("application_events")).toHaveLength(0);
    expect(archived().sort()).toEqual([1, 2, 3]);
  });

  it("leaves a failed send in the queue for a retry", async () => {
    db.queueRpc("read", { data: [message(5, 1)], error: null }, "pgmq_public");
    db.queue("applications", { data: [appRow(1)], error: null });
    vi.mocked(sendCompanyMessage).mockResolvedValueOnce({ ok: false, error: "Failed to send email" });

    expect(await (await run()).json()).toEqual({ sent: 0, dropped: 0, failed: 0 });

    expect(archived()).toEqual([]);
    expect(sendEmailForStatusUpdate).not.toHaveBeenCalled();
  });

  it(`gives up after ${PIPELINE_EMAIL_MAX_READS} reads and reports it`, async () => {
    db.queueRpc("read", { data: [message(5, 1, PIPELINE_EMAIL_MAX_READS)], error: null }, "pgmq_public");
    db.queue("applications", { data: [appRow(1)], error: null });
    vi.mocked(sendCompanyMessage).mockResolvedValueOnce({ ok: false, error: "Failed to send email" });

    expect(await (await run()).json()).toEqual({ sent: 0, dropped: 0, failed: 1 });

    expect(archived()).toEqual([5]);
    expect(sendEmailForStatusUpdate).toHaveBeenCalledWith(expect.stringContaining(appId(1)));
  });

  it("500s when the queue can't be read", async () => {
    db.queueRpc("read", { data: null, error: { message: "boom" } }, "pgmq_public");

    expect((await run()).status).toBe(500);
    expect(sendCompanyMessage).not.toHaveBeenCalled();
  });
});
