/**
 * Characterisation tests for POST /api/interview/start (SIT-001).
 * They pin today's practice-interview start (reserve → voice POST /sessions →
 * activate → session row) before the screening interview adds its own route.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { buildRequest } from "@/test/utils/request";
import { mockUser } from "@/test/utils/auth";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { createClient } from "@/lib/supabase/server";
import { loadInterviewData } from "@/helpers/interview/loadInterviewData";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/helpers/interview/loadInterviewData", () => ({ loadInterviewData: vi.fn() }));

const USER_ID = "u1";
const INTERVIEW_ID = "int-1";
const VOICE_SESSION_ID = "voice-sess-1";

let supabase: SupabaseMock;
let fetchMock: ReturnType<typeof vi.fn>;

const post = (body: unknown = { interviewId: INTERVIEW_ID }) =>
  POST(buildRequest("/api/interview/start", { method: "POST", body }));

const voiceResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const queueInterview = () => {
  supabase.queue("interviews", {
    data: { id: INTERVIEW_ID, user_info: { filled: true } },
    error: null,
  });
};

const queueHappyPath = () => {
  queueInterview();
  supabase.queueRpc("reserve_interview_session", { data: "reserved", error: null });
  fetchMock.mockResolvedValue(voiceResponse({ session_id: VOICE_SESSION_ID }));
  supabase.queueRpc("activate_interview_session", { data: true, error: null });
  supabase.queue("interview_sessions", { data: { id: "is-1" }, error: null });
};

const reservationId = () =>
  (supabase.callsFor("reserve_interview_session")[0].chain[0].args[1] as {
    p_reservation_id: string;
  }).p_reservation_id;

const releaseArgs = () =>
  supabase.callsFor("release_interview_session").map((c) => c.chain[0].args[1]);

beforeEach(() => {
  vi.stubEnv("VOICE_BACKEND_URL", "https://voice.test");
  vi.stubEnv("BACKEND_SECRET", "backend-secret");
  vi.stubEnv("NEXT_PUBLIC_VOICE_WS_URL", "wss://voice.test");
  supabase = createSupabaseMock({ user: mockUser({ id: USER_ID }) });
  vi.mocked(createClient).mockResolvedValue(supabase.client);
  vi.mocked(loadInterviewData).mockResolvedValue({
    profile: { name: "Ada", text: "Profile text" },
    job: { title: "Backend Engineer", description: "Build APIs" },
  } as never);
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("POST /api/interview/start: guards", () => {
  it("returns 401 without a user", async () => {
    supabase.setUser(null);

    const res = await post();

    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 400 without an interview id", async () => {
    const res = await post({});

    expect(res.status).toBe(400);
  });

  it("returns 404 when the interview isn't the user's", async () => {
    supabase.queue("interviews", { data: null, error: null });

    const res = await post();

    expect(res.status).toBe(404);
    const [lookup] = supabase.callsFor("interviews");
    expect(lookup.chain).toContainEqual({ method: "eq", args: ["id", INTERVIEW_ID] });
    expect(lookup.chain).toContainEqual({ method: "eq", args: ["user_id", USER_ID] });
  });

  it("returns 400 when the profile isn't filled", async () => {
    supabase.queue("interviews", {
      data: { id: INTERVIEW_ID, user_info: { filled: false } },
      error: null,
    });

    const res = await post();

    expect(res.status).toBe(400);
    expect(supabase.callsFor("reserve_interview_session")).toHaveLength(0);
  });

  it("returns 500 when the reservation errors", async () => {
    queueInterview();
    supabase.queueRpc("reserve_interview_session", { data: null, error: { message: "boom" } });

    const res = await post();

    expect(res.status).toBe(500);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 409 when a session is already active", async () => {
    queueInterview();
    supabase.queueRpc("reserve_interview_session", { data: "active", error: null });

    const res = await post();

    expect(res.status).toBe(409);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/interview/start: happy path", () => {
  it("reserves, creates the voice session, activates and records the session", async () => {
    queueHappyPath();

    const res = await post();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      wsUrl: `wss://voice.test/ws/interview?session_id=${VOICE_SESSION_ID}`,
      sessionId: VOICE_SESSION_ID,
      interviewSessionId: "is-1",
    });

    expect(reservationId()).toMatch(/^starting:[0-9a-f-]{36}$/);
    expect(supabase.callsFor("reserve_interview_session")[0].chain[0].args[1]).toEqual({
      p_interview_id: INTERVIEW_ID,
      p_reservation_id: reservationId(),
    });
    expect(supabase.callsFor("activate_interview_session")[0].chain[0].args[1]).toEqual({
      p_interview_id: INTERVIEW_ID,
      p_reservation_id: reservationId(),
      p_session_id: VOICE_SESSION_ID,
    });
    const [insert] = supabase.callsFor("interview_sessions");
    expect(insert.chain[0]).toEqual({
      method: "insert",
      args: [{ interview_id: INTERVIEW_ID, voice_session_id: VOICE_SESSION_ID, turns: [] }],
    });
    expect(releaseArgs()).toEqual([]);
  });

  it("sends exactly today's body to the voice server", async () => {
    queueHappyPath();

    await post();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://voice.test/sessions");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      "content-type": "application/json",
      "x-backend-secret": "backend-secret",
    });
    expect(JSON.parse(init.body as string)).toEqual({
      candidate_name: "Ada",
      profile: "Profile text",
      job_title: "Backend Engineer",
      job_description: "Build APIs",
      interview_id: INTERVIEW_ID,
    });
    expect(loadInterviewData).toHaveBeenCalledWith(USER_ID, INTERVIEW_ID);
  });
});

describe("POST /api/interview/start: failures release the reservation", () => {
  it("releases the reservation when the voice server fails", async () => {
    queueInterview();
    supabase.queueRpc("reserve_interview_session", { data: "reserved", error: null });
    fetchMock.mockResolvedValue(voiceResponse({ detail: "busy" }, 503));

    const res = await post();

    expect(res.status).toBe(502);
    expect(supabase.callsFor("activate_interview_session")).toHaveLength(0);
    expect(releaseArgs()).toEqual([
      { p_interview_id: INTERVIEW_ID, p_session_id: reservationId() },
    ]);
  });

  it("releases the reservation when the voice server returns no session id", async () => {
    queueInterview();
    supabase.queueRpc("reserve_interview_session", { data: "reserved", error: null });
    fetchMock.mockResolvedValue(voiceResponse({}));

    const res = await post();

    expect(res.status).toBe(502);
    expect(releaseArgs()).toEqual([
      { p_interview_id: INTERVIEW_ID, p_session_id: reservationId() },
    ]);
  });

  it("releases the reservation when activation fails", async () => {
    queueInterview();
    supabase.queueRpc("reserve_interview_session", { data: "reserved", error: null });
    fetchMock.mockResolvedValue(voiceResponse({ session_id: VOICE_SESSION_ID }));
    supabase.queueRpc("activate_interview_session", { data: false, error: null });

    const res = await post();

    expect(res.status).toBe(502);
    expect(supabase.callsFor("interview_sessions")).toHaveLength(0);
    expect(releaseArgs()).toEqual([
      { p_interview_id: INTERVIEW_ID, p_session_id: reservationId() },
    ]);
  });

  it("releases the activated session when the session row can't be inserted", async () => {
    queueInterview();
    supabase.queueRpc("reserve_interview_session", { data: "reserved", error: null });
    fetchMock.mockResolvedValue(voiceResponse({ session_id: VOICE_SESSION_ID }));
    supabase.queueRpc("activate_interview_session", { data: true, error: null });
    supabase.queue("interview_sessions", { data: null, error: { message: "insert failed" } });

    const res = await post();

    expect(res.status).toBe(502);
    expect(releaseArgs()).toEqual([
      { p_interview_id: INTERVIEW_ID, p_session_id: VOICE_SESSION_ID },
    ]);
  });
});
