import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendEmail } from "@/utils/email";
import { buildRequest } from "@/test/utils/request";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import fixture from "@/helpers/interview/screening/fixtures/transcript-callback.json";
import { GET, POST } from "./route";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/utils/email", () => ({ sendEmail: vi.fn(), sendEmailForStatusUpdate: vi.fn() }));
vi.mock("@/utils/formatters", () => ({ INTERNAL_API_SECRET: "test-secret", deploymentUrl: () => "https://app.test" }));

const NOW = new Date("2026-10-19T12:00:00.000Z");
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();
const snapshot = (duration = 15) => ({
  questions: [],
  competencies: [{ name: "Design", description: "d" }],
  duration_minutes: duration,
  deadline_days: 5,
  language: "en",
  company_name: "Acme",
  job_title: "Backend Engineer",
});

let db: SupabaseMock;
let fetchMock: ReturnType<typeof vi.fn>;
const getUserById = vi.fn();

const run = (handler: typeof GET = GET, secret: string | null = "test-secret") =>
  handler(
    buildRequest("/api/updates/screening-interviews", {
      method: handler === POST ? "POST" : "GET",
      headers: secret ? { "X-Internal-Secret": secret } : {},
    }),
  );

/** Nothing to expire, remind or sweep, unless a test queues it first. */
function queueQuiet({ expired = [] as string[] } = {}) {
  db.queueRpc("expire_screening_interviews", { data: expired, error: null });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  vi.stubEnv("VOICE_BACKEND_URL", "https://voice.test");
  vi.stubEnv("BACKEND_SECRET", "backend-secret");
  db = createSupabaseMock();
  (db.client.auth as unknown as { admin: unknown }).admin = { getUserById };
  getUserById.mockResolvedValue({ data: { user: { email: "owner@acme.dev" } }, error: null });
  vi.mocked(createServiceRoleClient).mockReturnValue(db.client);
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("/api/updates/screening-interviews (SI-REQ-014, SI-TEST-009)", () => {
  it.each([["no", null], ["a wrong", "nope"]])("401 with %s secret", async (_, secret) => {
    expect((await run(GET, secret)).status).toBe(401);
    expect(db.calls).toHaveLength(0);
  });

  it("returns the counts, for GET and POST", async () => {
    queueQuiet();
    const res = await run(POST);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ expired: 0, reminded: 0, swept: 0 });
  });

  it("emails both sides of each expired invite", async () => {
    queueQuiet({ expired: ["ai1"] });
    db.queue("application_interviews", {
      data: [{ id: "ai1", company_id: "c1", job_post_id: "j1", application_id: "app1", applicant_user_id: "a1", config_snapshot: snapshot() }],
      error: null,
    });
    db.queue("user_info", { data: [{ user_id: "a1", email: "priya@example.com", full_name: "Priya Sharma" }], error: null });
    db.queue("company_members", { data: [{ user_id: "o1", is_owner: true, role_id: null }], error: null });

    expect(await (await run()).json()).toMatchObject({ expired: 1 });

    const mails = vi.mocked(sendEmail).mock.calls.map((c) => c[0]);
    expect(mails.map((m) => m.toEmail).sort()).toEqual(["owner@acme.dev", "priya@example.com"]);
    expect(mails.find((m) => m.toEmail === "priya@example.com")!.textContent).toContain("has expired");
    const company = mails.find((m) => m.toEmail === "owner@acme.dev")!;
    expect(company.textContent).toContain("Priya Sharma didn't take the AI interview");
    expect(company.htmlContent).toContain("https://app.test/company/applications/app1");
  });

  it("sends a reminder once: the claim sets reminder_sent_at, so a second run finds none", async () => {
    queueQuiet();
    db.queue("application_interviews", {
      data: [{ id: "ai2", applicant_user_id: "a2", deadline_at: "2026-10-20T12:00:00.000Z", config_snapshot: snapshot() }],
      error: null,
    });
    db.queue("user_info", { data: [{ user_id: "a2", email: "sam@example.com", full_name: "Sam" }], error: null });

    expect(await (await run()).json()).toMatchObject({ reminded: 1 });
    const claim = db.callsFor("application_interviews")[0].chain;
    expect(claim[0].method).toBe("update");
    expect(claim).toEqual(
      expect.arrayContaining([
        { method: "eq", args: ["status", "invited"] },
        { method: "eq", args: ["attempts_used", 0] },
        { method: "is", args: ["reminder_sent_at", null] },
        { method: "lte", args: ["deadline_at", "2026-10-21T12:00:00.000Z"] },
        { method: "gt", args: ["deadline_at", NOW.toISOString()] },
      ]),
    );
    expect(vi.mocked(sendEmail).mock.calls[0][0]).toMatchObject({ toEmail: "sam@example.com" });
    expect(vi.mocked(sendEmail).mock.calls[0][0].htmlContent).toContain("https://app.test/interview/screening/ai2");

    vi.mocked(sendEmail).mockClear();
    queueQuiet();
    expect(await (await run()).json()).toMatchObject({ reminded: 0 });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  describe("an imported applicant who hasn't claimed it (BIT-063, BI-REQ-034/041)", () => {
    const CANDIDATE = "cc000000-0000-4000-8000-000000000001";
    const candidate = (over: Record<string, unknown> = {}) => ({
      id: CANDIDATE,
      email: "meera@mail.test",
      full_name: "Meera Iyer",
      email_opted_out_at: null,
      ...over,
    });

    it("reminds them at their candidate email with a new claim link and the unsubscribe link", async () => {
      queueQuiet();
      db.queue("application_interviews", {
        data: [
          {
            id: "ai3",
            company_id: "c1",
            applicant_user_id: null,
            company_candidate_id: CANDIDATE,
            deadline_at: "2026-10-20T12:00:00.000Z",
            config_snapshot: snapshot(),
          },
        ],
        error: null,
      });
      db.queue("company_candidates", { data: [candidate()], error: null });
      db.queue("company_candidate_claims", { data: null, error: null });

      expect(await (await run()).json()).toMatchObject({ reminded: 1 });
      const mail = vi.mocked(sendEmail).mock.calls[0][0];
      expect(mail.toEmail).toBe("meera@mail.test");
      expect(mail.htmlContent).toMatch(/https:\/\/app\.test\/claim\/[\w-]{43}/);
      expect(mail.htmlContent).not.toContain("/interview/screening/ai3");
      expect(mail.htmlContent).toContain(`https://app.test/unsubscribe/candidate/${CANDIDATE}.`);
      const insert = db.callsFor("company_candidate_claims")[0].chain.find((c) => c.method === "insert")!;
      expect(insert.args[0]).toMatchObject({
        candidate_id: CANDIDATE,
        application_interview_id: "ai3",
        expires_at: "2026-10-20T12:00:00.000Z",
      });
    });

    it("skips the reminder when they unsubscribed", async () => {
      queueQuiet();
      db.queue("application_interviews", {
        data: [
          {
            id: "ai3",
            company_id: "c1",
            applicant_user_id: null,
            company_candidate_id: CANDIDATE,
            deadline_at: "2026-10-20T12:00:00.000Z",
            config_snapshot: snapshot(),
          },
        ],
        error: null,
      });
      db.queue("company_candidates", { data: [candidate({ email_opted_out_at: "2026-10-18T00:00:00Z" })], error: null });

      expect(await (await run()).json()).toMatchObject({ reminded: 1 });
      expect(sendEmail).not.toHaveBeenCalled();
      expect(db.callsFor("company_candidate_claims")).toHaveLength(0);
    });

    it("tells them and the company when it expires, by the candidate's name", async () => {
      queueQuiet({ expired: ["ai4"] });
      db.queue("application_interviews", {
        data: [
          {
            id: "ai4",
            company_id: "c1",
            job_post_id: "j1",
            application_id: "app4",
            applicant_user_id: null,
            company_candidate_id: CANDIDATE,
            config_snapshot: snapshot(),
          },
        ],
        error: null,
      });
      db.queue("company_candidates", { data: [candidate()], error: null });
      db.queue("company_members", { data: [{ user_id: "o1", is_owner: true, role_id: null }], error: null });

      expect(await (await run()).json()).toMatchObject({ expired: 1 });
      const mails = vi.mocked(sendEmail).mock.calls.map((c) => c[0]);
      const theirs = mails.find((m) => m.toEmail === "meera@mail.test")!;
      expect(theirs.htmlContent).toContain(`https://app.test/unsubscribe/candidate/${CANDIDATE}.`);
      expect(mails.find((m) => m.toEmail === "owner@acme.dev")!.textContent).toContain(
        "Meera Iyer didn't take the AI interview",
      );
    });
  });

  it("sweeps a stuck session with the voice server's stored result", async () => {
    queueQuiet();
    db.queue("interview_sessions", {
      data: [
        // 15-minute interview, started 26 minutes ago: past length + 10.
        { id: "is-old", voice_session_id: "sid-old", started_at: minutesAgo(26), interviews: { application_interviews: { config_snapshot: snapshot(15) } } },
        // A 20-minute interview started 26 minutes ago may still be running.
        { id: "is-running", voice_session_id: "sid-run", started_at: minutesAgo(26), interviews: { application_interviews: { config_snapshot: snapshot(20) } } },
      ],
      error: null,
    });
    fetchMock.mockResolvedValue(new Response(JSON.stringify(fixture), { status: 200 }));
    db.queueRpc("finish_screening_session", { data: { ok: true, status: "recorded" }, error: null });

    expect(await (await run()).json()).toMatchObject({ swept: 1 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://voice.test/sessions/sid-old/result");
    expect(init.headers["x-backend-secret"]).toBe("backend-secret");
    expect(db.callsFor("finish_screening_session")[0].chain[0].args[1]).toEqual({
      p_session_id: "is-old",
      p_turns: fixture.turns,
      p_end_reason: fixture.endReason,
      p_duration_seconds: fixture.durationSeconds,
    });
    const query = db.callsFor("interview_sessions")[0].chain;
    expect(query).toContainEqual({ method: "eq", args: ["status", "active"] });
    expect(query).toContainEqual({ method: "eq", args: ["transcript_source", "server"] });
  });

  it("falls back to no_callback when the voice server has nothing", async () => {
    queueQuiet();
    db.queue("interview_sessions", {
      data: [{ id: "is-old", voice_session_id: "sid-old", started_at: minutesAgo(40), interviews: { application_interviews: { config_snapshot: snapshot(10) } } }],
      error: null,
    });
    fetchMock.mockResolvedValue(new Response(null, { status: 404 }));
    db.queueRpc("finish_screening_session", { data: { ok: true, status: "recorded" }, error: null });

    await run();
    expect(db.callsFor("finish_screening_session")[0].chain[0].args[1]).toEqual({
      p_session_id: "is-old",
      p_turns: [],
      p_end_reason: "no_callback",
      p_duration_seconds: null,
    });
  });

  it("emails the company when a swept interview completes too short to score", async () => {
    queueQuiet();
    db.queue("interview_sessions", {
      data: [
        {
          id: "is-old",
          voice_session_id: "sid-old",
          started_at: minutesAgo(40),
          interviews: { application_interview_id: "ai-1", application_interviews: { config_snapshot: snapshot(10) } },
        },
      ],
      error: null,
    });
    fetchMock.mockResolvedValue(new Response(null, { status: 404 }));
    db.queueRpc("finish_screening_session", {
      data: { ok: true, status: "recorded", interview_status: "completed", analysis_id: null },
      error: null,
    });
    // No reminders due; then the swept interview.
    db.queue("application_interviews", { data: [], error: null });
    db.queue("application_interviews", {
      data: {
        id: "ai-1",
        company_id: "c1",
        job_post_id: "j1",
        application_id: "app-1",
        applicant_user_id: "u1",
        config_snapshot: snapshot(10),
      },
      error: null,
    });
    db.queue("user_info", { data: [{ user_id: "u1", email: "priya@example.com", full_name: "Priya Sharma" }], error: null });
    db.queue("company_members", { data: [{ user_id: "owner", is_owner: true, role_id: null }], error: null });

    await run();

    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        toEmail: "owner@acme.dev",
        subject: "Priya Sharma finished the AI interview for Backend Engineer",
      }),
    );
    expect(vi.mocked(sendEmail).mock.calls[0][0].textContent).toContain("too short to score");
  });

  it("500 and an alert when expiry fails", async () => {
    db.queueRpc("expire_screening_interviews", { data: null, error: { message: "down" } });
    expect((await run()).status).toBe(500);
  });
});
