import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { buildRequest } from "@/test/utils/request";
import { mockUser, setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { loadCandidateContext } from "@/helpers/interview/screening/candidate-context";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/helpers/interview/screening/candidate-context", () => ({ loadCandidateContext: vi.fn() }));

const APPLICANT = mockUser({ type: "applicant", id: "a0000000-0000-4000-8000-000000000001" });
const AI = "fa000000-0000-4000-8000-000000000001";
const INTERVIEW = "1e000000-0000-4000-8000-000000000001";
const APP = "e0000000-0000-4000-8000-000000000001";
const SID = "voice-sid-1";

const snapshot = {
  questions: [{ text: "Why this role?" }],
  competencies: [{ name: "System design", description: "Trade-offs at scale" }],
  duration_minutes: 15,
  deadline_days: 5,
  language: "en",
  company_name: "Acme",
  job_title: "Backend Engineer",
};

let rls: SupabaseMock;
let service: SupabaseMock;
let fetchMock: ReturnType<typeof vi.fn>;

const post = (body: unknown = { applicationInterviewId: AI }) =>
  POST(buildRequest("/api/interview/screening/start", { method: "POST", body }));

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const voiceCalls = (method: string) => fetchMock.mock.calls.filter(([, init]) => (init?.method ?? "GET") === method);

function queueReserved() {
  rls.queueRpc("reserve_screening_attempt", { data: { ok: true, interview_id: INTERVIEW }, error: null });
  service.queue("application_interviews", {
    data: { id: AI, application_id: APP, interview_id: INTERVIEW, job_post_id: "job-1", config_snapshot: snapshot },
    error: null,
  });
  service.queue("job_postings", { data: { description: "Build payment APIs." }, error: null });
}

beforeEach(async () => {
  vi.stubEnv("VOICE_BACKEND_URL", "https://voice.test");
  vi.stubEnv("BACKEND_SECRET", "backend-secret");
  vi.stubEnv("NEXT_PUBLIC_VOICE_WS_URL", "wss://voice.test");
  rls = createSupabaseMock({ user: APPLICANT });
  service = createSupabaseMock();
  vi.mocked(createServiceRoleClient).mockReturnValue(service.client);
  await setRequestUser(APPLICANT, rls.client);
  vi.mocked(loadCandidateContext).mockResolvedValue({ ok: true, firstName: "Priya", context: "Experience:\n- APIs" });
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("POST /api/interview/screening/start: guards (SI-REQ-021, SI-TEST-003)", () => {
  it("401 without a user", async () => {
    await setRequestUser(null, rls.client);
    expect((await post()).status).toBe(401);
  });

  it("403 for a company account", async () => {
    await setRequestUser(mockUser({ type: "company" }), rls.client);
    expect((await post()).status).toBe(403);
    expect(rls.callsFor("reserve_screening_attempt")).toHaveLength(0);
  });

  it("400 without an id", async () => {
    expect((await post({})).status).toBe(400);
  });

  it.each([
    ["not_found", 404],
    ["not_invited", 409],
    ["active_session", 409],
    ["no_attempts", 409],
    ["expired", 410],
    ["no_consent", 428],
  ])("%s → %i, without calling the voice server", async (reason, status) => {
    rls.queueRpc("reserve_screening_attempt", { data: { ok: false, reason }, error: null });
    const res = await post();
    expect(res.status).toBe(status);
    expect(await res.json()).toMatchObject({ code: reason });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/interview/screening/start: the session", () => {
  it("creates a screening voice session with the snapshot and no private fields", async () => {
    queueReserved();
    fetchMock.mockResolvedValue(json({ session_id: SID }));
    rls.queueRpc("start_screening_attempt", { data: { ok: true, session_id: "is-1" }, error: null });

    const res = await post();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      wsUrl: `wss://voice.test/ws/interview?session_id=${SID}`,
      sessionId: SID,
      interviewSessionId: "is-1",
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://voice.test/sessions");
    expect(init.headers["x-backend-secret"]).toBe("backend-secret");
    const body = JSON.parse(init.body);
    expect(body).toEqual({
      mode: "screening",
      interview_id: INTERVIEW,
      candidate_name: "Priya",
      profile: "Experience:\n- APIs",
      job_title: "Backend Engineer",
      job_description: "Build payment APIs.",
      company_name: "Acme",
      questions: ["Why this role?"],
      competencies: [{ name: "System design", description: "Trade-offs at scale" }],
      max_minutes: 15,
    });
    expect(JSON.stringify(body)).not.toMatch(/salary|visa|email|@|Sharma/i);
    expect(loadCandidateContext).toHaveBeenCalledWith(service.client, APP);
    // The snapshot is read as the applicant's own row.
    expect(service.callsFor("application_interviews")[0].chain).toContainEqual({
      method: "eq",
      args: ["applicant_user_id", APPLICANT.id],
    });
    const reservation = (rls.callsFor("reserve_screening_attempt")[0].chain[0].args[1] as { p_reservation_id: string })
      .p_reservation_id;
    expect(rls.callsFor("start_screening_attempt")[0].chain[0].args[1]).toEqual({
      p_id: AI,
      p_reservation_id: reservation,
      p_voice_session_id: SID,
    });
  });

  it("503 voice_busy when the voice server is at its limit, releasing the reservation", async () => {
    queueReserved();
    fetchMock.mockResolvedValue(json({ detail: "Rate limit exceeded" }, 429));

    const res = await post();

    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "voice_busy" });
    expect(rls.callsFor("release_interview_session")).toHaveLength(1);
    expect(rls.callsFor("start_screening_attempt")).toHaveLength(0);
  });

  it("502 when the voice server fails, releasing the reservation", async () => {
    queueReserved();
    fetchMock.mockRejectedValue(new Error("down"));
    expect((await post()).status).toBe(502);
    expect(rls.callsFor("release_interview_session")).toHaveLength(1);
  });

  it("deletes the voice session and releases when the start is refused", async () => {
    queueReserved();
    fetchMock.mockResolvedValueOnce(json({ session_id: SID })).mockResolvedValueOnce(new Response(null, { status: 204 }));
    rls.queueRpc("start_screening_attempt", { data: { ok: false, reason: "reservation_expired" }, error: null });

    const res = await post();

    expect(res.status).toBe(409);
    const [deleteCall] = voiceCalls("DELETE");
    expect(deleteCall[0]).toBe(`https://voice.test/sessions/${SID}`);
    expect(deleteCall[1].headers["x-backend-secret"]).toBe("backend-secret");
    expect(rls.callsFor("release_interview_session")).toHaveLength(1);
  });

  it("starts without a resume rather than blocking the candidate", async () => {
    queueReserved();
    vi.mocked(loadCandidateContext).mockResolvedValue({ ok: false, error: "This application has no resume." });
    fetchMock.mockResolvedValue(json({ session_id: SID }));
    rls.queueRpc("start_screening_attempt", { data: { ok: true, session_id: "is-1" }, error: null });

    expect((await post()).status).toBe(200);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ profile: "", candidate_name: "there" });
  });
});
