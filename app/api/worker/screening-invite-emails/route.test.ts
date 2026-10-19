import { beforeEach, describe, expect, it, vi } from "vitest";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendInterviewInviteEmail } from "@/helpers/interview/screening/invite";
import { SCREENING_INVITE_EMAIL_MAX_READS } from "@/helpers/interview/screening/invite-email-queue";
import { sendEmailForStatusUpdate } from "@/utils/email";
import { buildRequest } from "@/test/utils/request";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { GET } from "./route";

vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/helpers/interview/screening/invite", () => ({ sendInterviewInviteEmail: vi.fn() }));
vi.mock("@/utils/email", () => ({ sendEmailForStatusUpdate: vi.fn() }));
vi.mock("@/utils/formatters", () => ({ INTERNAL_API_SECRET: "test-secret" }));
vi.mock("server-only", () => ({}));

const ai = (n: number) => `fa000000-0000-4000-8000-00000000000${n}`;
const applicant = (n: number) => `a0000000-0000-4000-8000-00000000000${n}`;

let db: SupabaseMock;

const message = (msg_id: number, n: number, read_ct = 1) => ({
  msg_id,
  read_ct,
  message: { application_interview_id: ai(n) },
});
const interview = (n: number, status = "invited") => ({
  id: ai(n),
  status,
  applicant_user_id: applicant(n),
  deadline_at: "2026-10-24T12:00:00.000Z",
  config_snapshot: { company_name: "Acme", job_title: "Backend Engineer" },
});
const person = (n: number, email: string | null = `c${n}@example.com`) => ({
  user_id: applicant(n),
  email,
  full_name: `Cand${n} Last`,
});

const run = () =>
  GET(buildRequest("/api/worker/screening-invite-emails", { headers: { "X-Internal-Secret": "test-secret" } }));

const archived = () =>
  db.callsFor("archive").map((c) => (c.chain[0].args[1] as { message_id: number }).message_id);

function queueBatch(
  messages: ReturnType<typeof message>[],
  interviews: ReturnType<typeof interview>[],
  people: ReturnType<typeof person>[],
) {
  db.queueRpc("read", { data: messages, error: null }, "pgmq_public");
  db.queue("application_interviews", { data: interviews, error: null });
  db.queue("user_info", { data: people, error: null });
}

beforeEach(() => {
  vi.clearAllMocks();
  db = createSupabaseMock();
  vi.mocked(createServiceRoleClient).mockReturnValue(db.client);
  vi.mocked(sendInterviewInviteEmail).mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/worker/screening-invite-emails", () => {
  it("401s without the secret", async () => {
    const res = await GET(buildRequest("/api/worker/screening-invite-emails"));

    expect(res.status).toBe(401);
    expect(db.calls).toHaveLength(0);
  });

  it("does nothing on an empty queue", async () => {
    db.queueRpc("read", { data: [], error: null }, "pgmq_public");

    expect(await (await run()).json()).toEqual({ sent: 0, dropped: 0, failed: 0 });
    expect(db.callsFor("application_interviews")).toHaveLength(0);
  });

  it("reads from the invite email queue", async () => {
    db.queueRpc("read", { data: [], error: null }, "pgmq_public");
    await run();
    expect(db.callsFor("read")[0].chain[0].args[1]).toMatchObject({ queue_name: "screening_invite_email_queue" });
  });

  it("sends each invite to the address in the DB and archives it", async () => {
    queueBatch([message(7, 1), message(8, 2)], [interview(1), interview(2)], [person(1), person(2)]);

    expect(await (await run()).json()).toEqual({ sent: 2, dropped: 0, failed: 0 });

    expect(sendInterviewInviteEmail).toHaveBeenCalledWith(interview(1), {
      email: "c1@example.com",
      full_name: "Cand1 Last",
    });
    expect(sendInterviewInviteEmail).toHaveBeenCalledTimes(2);
    expect(archived().sort()).toEqual([7, 8]);
  });

  it("drops an interview that's gone, no longer invited, or whose applicant has no address", async () => {
    queueBatch(
      [message(1, 1), message(2, 2), message(3, 3)],
      [interview(2, "cancelled"), interview(3)],
      [person(3, null)],
    );

    expect(await (await run()).json()).toEqual({ sent: 0, dropped: 3, failed: 0 });
    expect(sendInterviewInviteEmail).not.toHaveBeenCalled();
    expect(archived().sort()).toEqual([1, 2, 3]);
  });

  it("leaves a failed send in the queue for a retry", async () => {
    vi.mocked(sendInterviewInviteEmail).mockRejectedValueOnce(new Error("provider down"));
    queueBatch([message(5, 1)], [interview(1)], [person(1)]);

    expect(await (await run()).json()).toEqual({ sent: 0, dropped: 0, failed: 0 });
    expect(archived()).toEqual([]);
    expect(sendEmailForStatusUpdate).not.toHaveBeenCalled();
  });

  it("gives up after the last read, archives and reports it", async () => {
    vi.mocked(sendInterviewInviteEmail).mockRejectedValueOnce(new Error("provider down"));
    queueBatch([message(5, 1, SCREENING_INVITE_EMAIL_MAX_READS)], [interview(1)], [person(1)]);

    expect(await (await run()).json()).toEqual({ sent: 0, dropped: 0, failed: 1 });
    expect(archived()).toEqual([5]);
    expect(vi.mocked(sendEmailForStatusUpdate).mock.calls[0][0]).toContain(`interview ${ai(1)}: provider down`);
  });

  it("sends at most 5 at once", async () => {
    let active = 0;
    let peak = 0;
    vi.mocked(sendInterviewInviteEmail).mockImplementation(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 1));
      active--;
    });
    const ns = [1, 2, 3, 4, 5, 6, 7];
    queueBatch(ns.map((n) => message(n, n)), ns.map((n) => interview(n)), ns.map((n) => person(n)));

    expect(await (await run()).json()).toEqual({ sent: 7, dropped: 0, failed: 0 });
    expect(peak).toBe(5);
  });

  it("500s when the queue can't be read", async () => {
    db.queueRpc("read", { data: null, error: { message: "down" } }, "pgmq_public");
    expect((await run()).status).toBe(500);
  });
});
