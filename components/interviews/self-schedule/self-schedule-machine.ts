// The candidate's steps on /schedule/[token] (IVT-063): pick a time (to book
// or to move a booking), or confirm a cancel. Pure, so each event is tested.

export type Slot = { start: string; end: string };
export type LinkStatus = "awaiting_candidate" | "scheduled";
export type Done = "booked" | "rescheduled" | "cancelled";

export type SelfScheduleState = {
  /** `view`: the booked time. `pick`: choosing a time. `confirm_cancel`: asking before cancelling. */
  mode: "view" | "pick" | "confirm_cancel";
  status: LinkStatus;
  zone: string;
  slot: Slot | null;
  submitting: boolean;
  error: string | null;
  /** What the last change did, for the confirmation line. */
  done: Done | null;
};

export type SelfScheduleEvent =
  | { type: "zone"; zone: string }
  | { type: "reschedule" }
  | { type: "ask_cancel" }
  | { type: "back" }
  | { type: "pick"; slot: Slot }
  | { type: "submit" }
  | { type: "failed"; reason: string; error: string }
  | { type: "succeeded"; done: Done };

export function initialSelfSchedule(status: LinkStatus, zone: string): SelfScheduleState {
  return {
    mode: status === "awaiting_candidate" ? "pick" : "view",
    status,
    zone,
    slot: null,
    submitting: false,
    error: null,
    done: null,
  };
}

/** What the submit button does in the current state. */
export function pendingAction(state: SelfScheduleState): "book" | "reschedule" | "cancel" | null {
  if (state.mode === "confirm_cancel") return "cancel";
  if (state.mode !== "pick" || !state.slot) return null;
  return state.status === "scheduled" ? "reschedule" : "book";
}

export function selfScheduleReducer(state: SelfScheduleState, event: SelfScheduleEvent): SelfScheduleState {
  if (state.submitting && event.type !== "failed" && event.type !== "succeeded" && event.type !== "zone") return state;
  switch (event.type) {
    case "zone":
      return { ...state, zone: event.zone };
    case "reschedule":
      return state.status === "scheduled" ? { ...state, mode: "pick", slot: null, error: null, done: null } : state;
    case "ask_cancel":
      return state.status === "scheduled" ? { ...state, mode: "confirm_cancel", error: null, done: null } : state;
    case "back":
      // Nothing to go back to before the first booking.
      return state.status === "scheduled" ? { ...state, mode: "view", slot: null, error: null } : state;
    case "pick":
      return state.mode === "pick" ? { ...state, slot: event.slot, error: null } : state;
    case "submit":
      return pendingAction(state) ? { ...state, submitting: true, error: null } : state;
    case "failed":
      return {
        ...state,
        submitting: false,
        error: event.error,
        // A taken time can't be picked again; the refreshed list won't have it.
        slot: event.reason === "slot_taken" || event.reason === "invalid_time" ? null : state.slot,
      };
    case "succeeded": {
      const status: LinkStatus = event.done === "cancelled" ? "awaiting_candidate" : "scheduled";
      return { ...initialSelfSchedule(status, state.zone), done: event.done };
    }
  }
}
