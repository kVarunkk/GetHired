// The candidate's way into a screening interview (SM-REQ-011): consent, then a
// microphone check, then Continue. Pure, so every event in every state is
// tested in screening-interview-machine.test.ts. The invite itself (status,
// attempts) is server data and stays outside the reducer.

export type MicCheck = "unchecked" | "checking" | "failed";

export type ScreeningStep =
  | { step: "consent"; saving: boolean }
  | { step: "micCheck"; mic: MicCheck }
  // The microphone works; Continue is allowed.
  | { step: "ready" }
  | { step: "entered" };

export type ScreeningDialog = "decline" | "accommodation";

export type ScreeningFlowState = ScreeningStep & {
  // The intro page's dialogs. Never open once the candidate has entered.
  dialog: ScreeningDialog | null;
  // Reading the invite again after an attempt, until the voice server's
  // transcript report moves it out of in_progress.
  checking: boolean;
};

export type ScreeningFlowEvent =
  | { type: "consentStart" }
  | { type: "consentSaved" }
  | { type: "consentFailed" }
  | { type: "micCheckStart" }
  | { type: "micOk" }
  | { type: "micFailed" }
  | { type: "enter" }
  | { type: "openDialog"; dialog: ScreeningDialog }
  | { type: "closeDialog" }
  | { type: "attemptEnded" }
  | { type: "checkDone" };

export function initialScreeningFlow({
  consented,
  inProgress,
}: {
  consented: boolean;
  inProgress: boolean;
}): ScreeningFlowState {
  const step: ScreeningStep = consented
    ? { step: "micCheck", mic: "unchecked" }
    : { step: "consent", saving: false };
  return { ...step, dialog: null, checking: inProgress };
}

export function screeningFlowReducer(
  state: ScreeningFlowState,
  event: ScreeningFlowEvent,
): ScreeningFlowState {
  const { dialog, checking } = state;
  const to = (step: ScreeningStep): ScreeningFlowState => ({ ...step, dialog, checking });

  switch (event.type) {
    case "consentStart":
      return state.step === "consent" && !state.saving ? to({ step: "consent", saving: true }) : state;

    case "consentSaved":
      return state.step === "consent" ? to({ step: "micCheck", mic: "unchecked" }) : state;

    case "consentFailed":
      return state.step === "consent" ? to({ step: "consent", saving: false }) : state;

    case "micCheckStart":
      // A working microphone can be checked again.
      return (state.step === "micCheck" && state.mic !== "checking") || state.step === "ready"
        ? to({ step: "micCheck", mic: "checking" })
        : state;

    case "micOk":
      return state.step === "micCheck" && state.mic === "checking" ? to({ step: "ready" }) : state;

    case "micFailed":
      return state.step === "micCheck" && state.mic === "checking"
        ? to({ step: "micCheck", mic: "failed" })
        : state;

    case "enter":
      return state.step === "ready" ? { step: "entered", dialog: null, checking } : state;

    case "openDialog":
      return state.step === "entered" ? state : { ...state, dialog: event.dialog };

    case "closeDialog":
      return dialog ? { ...state, dialog: null } : state;

    case "attemptEnded":
      return checking ? state : { ...state, checking: true };

    case "checkDone":
      return checking ? { ...state, checking: false } : state;
  }
}

export const hasConsented = (state: ScreeningFlowState) => state.step !== "consent";

export const micStatus = (state: ScreeningFlowState): MicCheck | "ok" =>
  state.step === "micCheck" ? state.mic : state.step === "consent" ? "unchecked" : "ok";
