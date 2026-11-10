// The voice session's flow state (SM-REQ-011). Pure, so every event in every
// state is tested in voice-agent-machine.test.ts. `useVoiceAgent` dispatches
// these events; the refs it keeps (runIdRef, the audio graph, the
// utterance-ended flag) only guard its async callbacks and never pick a state.

export const VOICE_BUSY_MESSAGE = "Our interview server is busy. Please try again in a minute.";

export type VoiceState =
  | { status: "idle" }
  | { status: "connecting" }
  // `lockLost` is the heartbeat's message once another tab took the session:
  // the call keeps going until it ends, and then it ends in error.
  | { status: "live"; lockLost: string | null }
  | { status: "error"; message: string }
  | { status: "stopped" };

export type Status = VoiceState["status"];

export type VoiceEvent =
  | { type: "start" }
  // The socket is open, the mic is connected and (practice) credits charged.
  | { type: "ready" }
  | { type: "fail"; message: string }
  | { type: "lockLost"; message: string }
  // The call ended: the server closed the socket or the user pressed Stop.
  // `busy` is a screening socket refused with 1013.
  | { type: "end"; busy?: boolean };

export const initialVoiceState: VoiceState = { status: "idle" };

export function voiceAgentReducer(state: VoiceState, event: VoiceEvent): VoiceState {
  switch (event.type) {
    case "start":
      // A running call is never restarted; the hook's own guard agrees.
      return state.status === "connecting" || state.status === "live"
        ? state
        : { status: "connecting" };

    case "ready":
      return state.status === "connecting" ? { status: "live", lockLost: null } : state;

    case "fail":
      return state.status === "connecting" || state.status === "live"
        ? { status: "error", message: event.message }
        : state;

    case "lockLost":
      return state.status === "live" ? { status: "live", lockLost: event.message } : state;

    case "end":
      if (state.status !== "connecting" && state.status !== "live") return state;
      if (event.busy) return { status: "error", message: VOICE_BUSY_MESSAGE };
      if (state.status === "live" && state.lockLost) {
        return { status: "error", message: state.lockLost };
      }
      return { status: "stopped" };
  }
}

/** The message the UI shows: the error's, or a lost lock's while still live. */
export function voiceErrorMessage(state: VoiceState): string | null {
  if (state.status === "error") return state.message;
  if (state.status === "live") return state.lockLost;
  return null;
}
