import { describe, expect, it } from "vitest";
import {
  VOICE_BUSY_MESSAGE,
  initialVoiceState,
  voiceAgentReducer,
  voiceErrorMessage,
  type VoiceEvent,
  type VoiceState,
} from "./voice-agent-machine";

const idle: VoiceState = { status: "idle" };
const connecting: VoiceState = { status: "connecting" };
const live: VoiceState = { status: "live", lockLost: null };
const liveLockLost: VoiceState = { status: "live", lockLost: "Open somewhere else." };
const error: VoiceState = { status: "error", message: "Not enough credits." };
const stopped: VoiceState = { status: "stopped" };

const start: VoiceEvent = { type: "start" };
const ready: VoiceEvent = { type: "ready" };
const fail: VoiceEvent = { type: "fail", message: "The voice connection failed." };
const lockLost: VoiceEvent = { type: "lockLost", message: "Open somewhere else." };
const end: VoiceEvent = { type: "end" };
const endBusy: VoiceEvent = { type: "end", busy: true };

const failed: VoiceState = { status: "error", message: "The voice connection failed." };
const busyError: VoiceState = { status: "error", message: VOICE_BUSY_MESSAGE };

// SM-TEST-008: every event in every state.
const table: [string, VoiceState, Record<string, VoiceState>][] = [
  ["idle", idle, { start: connecting, ready: idle, fail: idle, lockLost: idle, end: idle, endBusy: idle }],
  [
    "connecting",
    connecting,
    { start: connecting, ready: live, fail: failed, lockLost: connecting, end: stopped, endBusy: busyError },
  ],
  ["live", live, { start: live, ready: live, fail: failed, lockLost: liveLockLost, end: stopped, endBusy: busyError }],
  [
    "live, lock lost",
    liveLockLost,
    {
      start: liveLockLost,
      ready: liveLockLost,
      fail: failed,
      lockLost: liveLockLost,
      end: { status: "error", message: "Open somewhere else." },
      endBusy: busyError,
    },
  ],
  ["error", error, { start: connecting, ready: error, fail: error, lockLost: error, end: error, endBusy: error }],
  ["stopped", stopped, { start: connecting, ready: stopped, fail: stopped, lockLost: stopped, end: stopped, endBusy: stopped }],
];

const events: Record<string, VoiceEvent> = { start, ready, fail, lockLost, end, endBusy };

describe("voiceAgentReducer", () => {
  it("starts idle", () => {
    expect(initialVoiceState).toEqual(idle);
  });

  for (const [name, state, expected] of table) {
    describe(`in ${name}`, () => {
      for (const [eventName, event] of Object.entries(events)) {
        it(`${eventName} → ${expected[eventName].status}`, () => {
          expect(voiceAgentReducer(state, event)).toEqual(expected[eventName]);
        });
      }
    });
  }

  it("covers every event in the table", () => {
    for (const [, , expected] of table) {
      expect(Object.keys(expected).sort()).toEqual(Object.keys(events).sort());
    }
  });

  // The old hook's `:513` choice: error when the lock was lost or the server
  // was busy, stopped otherwise, with busy's message winning.
  it("ends in the busy error even when the lock was lost too", () => {
    expect(voiceAgentReducer(liveLockLost, endBusy)).toEqual(busyError);
  });

  it("keeps an error when the socket closes after it", () => {
    // ws.onerror then ws.onclose: before, the close turned it into `stopped`
    // with the error message still set.
    expect(voiceAgentReducer(voiceAgentReducer(live, fail), end)).toEqual(failed);
  });
});

describe("voiceErrorMessage", () => {
  it("is the error's message, a lost lock's while live, and null otherwise", () => {
    expect(voiceErrorMessage(error)).toBe("Not enough credits.");
    expect(voiceErrorMessage(liveLockLost)).toBe("Open somewhere else.");
    expect(voiceErrorMessage(live)).toBeNull();
    expect(voiceErrorMessage(idle)).toBeNull();
    expect(voiceErrorMessage(connecting)).toBeNull();
    expect(voiceErrorMessage(stopped)).toBeNull();
  });
});
