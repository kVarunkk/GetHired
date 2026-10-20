/**
 * Characterisation tests for useVoiceAgent in practice mode (SIT-002).
 * They pin today's start, turn saving, credit charge, finalize, heartbeat and
 * release behaviour before the hook gains a screening mode.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useVoiceAgent } from "./useVoiceAgent";
import { savePracticeTurnsAction } from "@/app/actions/interviews/save-practice-turns";
import { deductInterviewSessionCreditsAction } from "@/app/actions/deduct-interview-session-credits";
import {
  heartbeatInterviewSessionAction,
  releaseInterviewSessionAction,
} from "@/app/actions/interview-session-lock";
import { finalizeInterviewSessionAction } from "@/app/actions/finalize-interview-session";

vi.mock("@/app/actions/interviews/save-practice-turns", () => ({
  savePracticeTurnsAction: vi.fn(),
}));
vi.mock("@/app/actions/deduct-interview-session-credits", () => ({
  deductInterviewSessionCreditsAction: vi.fn(),
}));
vi.mock("@/app/actions/interview-session-lock", () => ({
  heartbeatInterviewSessionAction: vi.fn(),
  releaseInterviewSessionAction: vi.fn(),
}));
vi.mock("@/app/actions/finalize-interview-session", () => ({
  finalizeInterviewSessionAction: vi.fn(),
}));

const INTERVIEW_ID = "int-1";
const VOICE_SESSION_ID = "voice-sess-1";
const INTERVIEW_SESSION_ID = "is-1";
const WS_URL = `wss://voice.test/ws/interview?session_id=${VOICE_SESSION_ID}`;

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;
  binaryType = "blob";
  sent: unknown[] = [];
  onopen: ((event: unknown) => unknown) | null = null;
  onmessage: ((event: { data: unknown }) => unknown) | null = null;
  onerror: ((event: unknown) => unknown) | null = null;
  onclose: ((event: { code: number }) => unknown) | null = null;
  close = vi.fn(() => {
    this.readyState = FakeWebSocket.CLOSED;
  });

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(data: unknown) {
    this.sent.push(data);
  }

  async serverOpen() {
    this.readyState = FakeWebSocket.OPEN;
    await this.onopen?.({});
  }

  serverMessage(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }

  serverClose(code = 1000) {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code });
  }
}

class FakeAudioContext {
  state = "running";
  currentTime = 0;
  destination = {};
  audioWorklet = { addModule: vi.fn(async () => {}) };
  constructor(public options: { sampleRate?: number } = {}) {}
  get sampleRate() {
    return this.options.sampleRate ?? 48000;
  }
  resume = vi.fn(async () => {});
  close = vi.fn(async () => {
    this.state = "closed";
  });
  createMediaStreamSource = vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() }));
}

class FakeAudioWorkletNode {
  port: { onmessage: ((event: { data: unknown }) => void) | null } = { onmessage: null };
  disconnect = vi.fn();
}

let fetchMock: ReturnType<typeof vi.fn>;
let track: { stop: ReturnType<typeof vi.fn>; label: string; getSettings: () => object };

const startResponse = () =>
  new Response(
    JSON.stringify({
      wsUrl: WS_URL,
      sessionId: VOICE_SESSION_ID,
      interviewSessionId: INTERVIEW_SESSION_ID,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );

const socket = () => FakeWebSocket.instances.at(-1)!;

const turn = (turnId: number, user: string, assistant: string) => ({
  turn_id: turnId,
  timestamp: "2026-10-18T10:00:00Z",
  user,
  assistant,
  interrupted: false,
});

/** Renders the hook and drives it to "live" through a started, opened socket. */
async function renderLive() {
  const hook = renderHook(() => useVoiceAgent(INTERVIEW_ID));
  await act(async () => {
    await hook.result.current.start();
  });
  await act(async () => {
    await socket().serverOpen();
  });
  expect(hook.result.current.status).toBe("live");
  return hook;
}

const savedTurns = () => vi.mocked(savePracticeTurnsAction).mock.calls.map(([input]) => input);

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.stubGlobal("AudioWorkletNode", FakeAudioWorkletNode);
  track = { stop: vi.fn(), label: "Mic", getSettings: () => ({}) };
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi.fn(async () => ({
        getTracks: () => [track],
        getAudioTracks: () => [track],
      })),
    },
  });
  fetchMock = vi.fn(async () => startResponse());
  vi.stubGlobal("fetch", fetchMock);

  vi.mocked(savePracticeTurnsAction).mockResolvedValue({ ok: true });
  vi.mocked(deductInterviewSessionCreditsAction).mockResolvedValue({ success: true } as never);
  vi.mocked(heartbeatInterviewSessionAction).mockResolvedValue({ status: "ok" } as never);
  vi.mocked(releaseInterviewSessionAction).mockResolvedValue({ success: true, error: null } as never);
  vi.mocked(finalizeInterviewSessionAction).mockResolvedValue({
    success: true,
    result: { sessionId: INTERVIEW_SESSION_ID, status: "completed" },
  } as never);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useVoiceAgent (practice): start", () => {
  it("starts through /api/interview/start and opens the returned socket", async () => {
    const { result } = renderHook(() => useVoiceAgent(INTERVIEW_ID));

    await act(async () => {
      await result.current.start();
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/interview/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ interviewId: INTERVIEW_ID }),
    });
    expect(socket().url).toBe(WS_URL);
    expect(socket().binaryType).toBe("arraybuffer");
    expect(result.current.status).toBe("connecting");
  });

  it("asks for the microphone and charges credits once the socket opens", async () => {
    const { result } = await renderLive();

    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
    expect(deductInterviewSessionCreditsAction).toHaveBeenCalledWith(
      INTERVIEW_ID,
      VOICE_SESSION_ID,
    );
    expect(result.current.errorMessage).toBeNull();
  });

  it("shows the route's error when the start fails", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "An interview session is already active." }), {
        status: 409,
      }),
    );
    const { result } = renderHook(() => useVoiceAgent(INTERVIEW_ID));

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.status).toBe("error");
    expect(result.current.errorMessage).toBe("An interview session is already active.");
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it("ends in error and releases the session when the credit charge fails", async () => {
    vi.mocked(deductInterviewSessionCreditsAction).mockResolvedValue({
      success: false,
      error: "Not enough credits.",
    } as never);
    const { result } = renderHook(() => useVoiceAgent(INTERVIEW_ID));

    await act(async () => {
      await result.current.start();
    });
    await act(async () => {
      await socket().serverOpen();
    });

    expect(result.current.status).toBe("error");
    expect(result.current.errorMessage).toBe("Not enough credits.");
    expect(releaseInterviewSessionAction).toHaveBeenCalledWith(INTERVIEW_ID, VOICE_SESSION_ID);
  });
});

describe("useVoiceAgent (practice): turns", () => {
  it("shows streamed transcript chunks and final transcripts", async () => {
    const { result } = await renderLive();

    act(() => {
      socket().serverMessage({ transcript_chunk: { role: "assistant", turn_id: "1", text: "Hello" } });
      socket().serverMessage({ transcript_chunk: { role: "assistant", turn_id: "1", text: "there" } });
    });
    expect(result.current.lines).toEqual([
      { role: "assistant", turn_id: "1", text: "Hello there", streaming: true },
    ]);

    act(() => {
      socket().serverMessage({ transcript: { role: "assistant", turn_id: "1", text: "Hello there." } });
    });
    expect(result.current.lines).toEqual([
      { role: "assistant", turn_id: "1", text: "Hello there.", streaming: false },
    ]);
  });

  it("saves every finished turn through the server action, replacing one with the same id", async () => {
    await renderLive();

    await act(async () => {
      socket().serverMessage({ turn: turn(1, "", "Hi, tell me about yourself.") });
      socket().serverMessage({ turn: turn(1, "I build APIs.", "Hi, tell me about yourself.") });
      socket().serverMessage({ turn: turn(2, "Go and Postgres.", "Which stack?") });
    });

    await waitFor(() => expect(savedTurns()).toHaveLength(3));
    expect(savedTurns()[2].turns).toEqual([
      turn(1, "I build APIs.", "Hi, tell me about yourself."),
      turn(2, "Go and Postgres.", "Which stack?"),
    ]);
    expect(savedTurns()[0]).toMatchObject({ interviewId: INTERVIEW_ID, sessionId: INTERVIEW_SESSION_ID });
  });
});

describe("useVoiceAgent (practice): ending", () => {
  it("finalizes and stops when the server closes the socket", async () => {
    const { result } = await renderLive();

    await act(async () => {
      socket().serverClose(1000);
    });

    await waitFor(() => expect(result.current.status).toBe("stopped"));
    expect(finalizeInterviewSessionAction).toHaveBeenCalledWith(INTERVIEW_ID, INTERVIEW_SESSION_ID);
    expect(result.current.analysisSession).toEqual({
      sessionId: INTERVIEW_SESSION_ID,
      status: "completed",
    });
    expect(releaseInterviewSessionAction).toHaveBeenCalledWith(INTERVIEW_ID, VOICE_SESSION_ID);
  });

  it("treats a 1013 close like any other close today (finalize, stopped, no busy message)", async () => {
    const { result } = await renderLive();

    await act(async () => {
      socket().serverClose(1013);
    });

    await waitFor(() => expect(result.current.status).toBe("stopped"));
    expect(result.current.errorMessage).toBeNull();
    expect(finalizeInterviewSessionAction).toHaveBeenCalledTimes(1);
  });

  it("finalizes, releases and closes the socket on stop", async () => {
    const { result } = await renderLive();
    const ws = socket();

    await act(async () => {
      result.current.stop();
    });

    await waitFor(() => expect(result.current.status).toBe("stopped"));
    expect(ws.close).toHaveBeenCalled();
    expect(finalizeInterviewSessionAction).toHaveBeenCalledTimes(1);
    expect(releaseInterviewSessionAction).toHaveBeenCalledWith(INTERVIEW_ID, VOICE_SESSION_ID);
    expect(track.stop).toHaveBeenCalled();
  });

  it("finalizes and releases on unmount", async () => {
    const { unmount } = await renderLive();

    unmount();

    await waitFor(() =>
      expect(finalizeInterviewSessionAction).toHaveBeenCalledWith(INTERVIEW_ID, INTERVIEW_SESSION_ID),
    );
    expect(releaseInterviewSessionAction).toHaveBeenCalledWith(INTERVIEW_ID, VOICE_SESSION_ID);
  });
});

describe("useVoiceAgent (practice): heartbeat", () => {
  it("heartbeats every 20 seconds while live", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    await renderLive();
    expect(heartbeatInterviewSessionAction).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(heartbeatInterviewSessionAction).toHaveBeenCalledWith(INTERVIEW_ID, VOICE_SESSION_ID);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(heartbeatInterviewSessionAction).toHaveBeenCalledTimes(2);
  });

  it("shows an error when the heartbeat reports the lock lost, and ends in error", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    vi.mocked(heartbeatInterviewSessionAction).mockResolvedValue({
      status: "lost",
      error: "This interview is open somewhere else.",
    } as never);
    const { result } = await renderLive();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(result.current.errorMessage).toBe("This interview is open somewhere else.");

    await act(async () => {
      socket().serverClose(1000);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(result.current.status).toBe("error");
  });
});

describe("useVoiceAgent (screening, SIT-051)", () => {
  const APPLICATION_INTERVIEW_ID = "ai-1";
  const renderScreening = () =>
    renderHook(() => useVoiceAgent(INTERVIEW_ID, { mode: "screening", applicationInterviewId: APPLICATION_INTERVIEW_ID }));

  async function renderScreeningLive() {
    const hook = renderScreening();
    await act(async () => {
      await hook.result.current.start();
    });
    await act(async () => {
      await socket().serverOpen();
    });
    expect(hook.result.current.status).toBe("live");
    return hook;
  }

  it("starts through the screening route with the application interview id", async () => {
    await renderScreeningLive();

    expect(fetchMock).toHaveBeenCalledWith("/api/interview/screening/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ applicationInterviewId: APPLICATION_INTERVIEW_ID }),
    });
    expect(socket().url).toBe(WS_URL);
  });

  it("never saves turns, charges credits or finalizes; the voice server records the transcript", async () => {
    const { result } = await renderScreeningLive();

    await act(async () => {
      socket().serverMessage({ transcript: { role: "user", turn_id: "1", text: "I build APIs." } });
      socket().serverMessage({ turn: turn(1, "I build APIs.", "Tell me about yourself.") });
    });
    expect(result.current.lines).toHaveLength(1);

    await act(async () => {
      socket().serverClose(1000);
    });
    await waitFor(() => expect(result.current.status).toBe("stopped"));

    expect(savePracticeTurnsAction).not.toHaveBeenCalled();
    expect(deductInterviewSessionCreditsAction).not.toHaveBeenCalled();
    expect(finalizeInterviewSessionAction).not.toHaveBeenCalled();
    expect(result.current.analysisSession).toBeNull();
    expect(releaseInterviewSessionAction).toHaveBeenCalledWith(INTERVIEW_ID, VOICE_SESSION_ID);
  });

  it("doesn't finalize on stop or unmount either", async () => {
    const { result, unmount } = await renderScreeningLive();
    await act(async () => {
      result.current.stop();
    });
    await waitFor(() => expect(result.current.status).toBe("stopped"));
    unmount();
    expect(finalizeInterviewSessionAction).not.toHaveBeenCalled();
    expect(releaseInterviewSessionAction).toHaveBeenCalledWith(INTERVIEW_ID, VOICE_SESSION_ID);
  });

  it("keeps the heartbeat", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    await renderScreeningLive();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(heartbeatInterviewSessionAction).toHaveBeenCalledWith(INTERVIEW_ID, VOICE_SESSION_ID);
  });

  it("shows the busy message on a 1013 close", async () => {
    const { result } = await renderScreeningLive();

    await act(async () => {
      socket().serverClose(1013);
    });

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.errorMessage).toBe("Our interview server is busy. Please try again in a minute.");
  });

  it("shows the route's refusal", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Agree to the interview terms first.", code: "no_consent" }), { status: 428 }),
    );
    const { result } = renderScreening();
    await act(async () => {
      await result.current.start();
    });
    expect(result.current.status).toBe("error");
    expect(result.current.errorMessage).toBe("Agree to the interview terms first.");
  });
});
