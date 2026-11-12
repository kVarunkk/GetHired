import { describe, expect, it } from "vitest";
import {
  hasConsented,
  initialScreeningFlow,
  micStatus,
  screeningFlowReducer,
  type ScreeningFlowEvent,
  type ScreeningFlowState,
  type ScreeningStep,
} from "./screening-interview-machine";

const at = (step: ScreeningStep, extra: Partial<ScreeningFlowState> = {}): ScreeningFlowState =>
  ({ ...step, dialog: null, checking: false, ...extra }) as ScreeningFlowState;

const consent = at({ step: "consent", saving: false });
const saving = at({ step: "consent", saving: true });
const unchecked = at({ step: "micCheck", mic: "unchecked" });
const micChecking = at({ step: "micCheck", mic: "checking" });
const micFailed = at({ step: "micCheck", mic: "failed" });
const ready = at({ step: "ready" });
const entered = at({ step: "entered" });

const events: Record<string, ScreeningFlowEvent> = {
  consentStart: { type: "consentStart" },
  consentSaved: { type: "consentSaved" },
  consentFailed: { type: "consentFailed" },
  micCheckStart: { type: "micCheckStart" },
  micOk: { type: "micOk" },
  micFailed: { type: "micFailed" },
  enter: { type: "enter" },
  openDecline: { type: "openDialog", dialog: "decline" },
  closeDialog: { type: "closeDialog" },
  attemptEnded: { type: "attemptEnded" },
  checkDone: { type: "checkDone" },
};

// SM-TEST-008: every event in every step. `same` means the event is ignored.
const same = Symbol("same");
type Expected = Record<keyof typeof events, ScreeningFlowState | typeof same>;

const withDecline = (s: ScreeningFlowState) => ({ ...s, dialog: "decline" as const });
const withChecking = (s: ScreeningFlowState) => ({ ...s, checking: true });

const table: [string, ScreeningFlowState, Expected][] = [
  [
    "consent",
    consent,
    {
      consentStart: saving,
      consentSaved: unchecked,
      consentFailed: consent,
      micCheckStart: same,
      micOk: same,
      micFailed: same,
      enter: same,
      openDecline: withDecline(consent),
      closeDialog: same,
      attemptEnded: withChecking(consent),
      checkDone: same,
    },
  ],
  [
    "consent, saving",
    saving,
    {
      consentStart: same,
      consentSaved: unchecked,
      consentFailed: consent,
      micCheckStart: same,
      micOk: same,
      micFailed: same,
      enter: same,
      openDecline: withDecline(saving),
      closeDialog: same,
      attemptEnded: withChecking(saving),
      checkDone: same,
    },
  ],
  [
    "micCheck, unchecked",
    unchecked,
    {
      consentStart: same,
      consentSaved: same,
      consentFailed: same,
      micCheckStart: micChecking,
      micOk: same,
      micFailed: same,
      enter: same,
      openDecline: withDecline(unchecked),
      closeDialog: same,
      attemptEnded: withChecking(unchecked),
      checkDone: same,
    },
  ],
  [
    "micCheck, checking",
    micChecking,
    {
      consentStart: same,
      consentSaved: same,
      consentFailed: same,
      micCheckStart: same,
      micOk: ready,
      micFailed: micFailed,
      enter: same,
      openDecline: withDecline(micChecking),
      closeDialog: same,
      attemptEnded: withChecking(micChecking),
      checkDone: same,
    },
  ],
  [
    "micCheck, failed",
    micFailed,
    {
      consentStart: same,
      consentSaved: same,
      consentFailed: same,
      micCheckStart: micChecking,
      micOk: same,
      micFailed: same,
      enter: same,
      openDecline: withDecline(micFailed),
      closeDialog: same,
      attemptEnded: withChecking(micFailed),
      checkDone: same,
    },
  ],
  [
    "ready",
    ready,
    {
      consentStart: same,
      consentSaved: same,
      consentFailed: same,
      micCheckStart: micChecking,
      micOk: same,
      micFailed: same,
      enter: entered,
      openDecline: withDecline(ready),
      closeDialog: same,
      attemptEnded: withChecking(ready),
      checkDone: same,
    },
  ],
  [
    "entered",
    entered,
    {
      consentStart: same,
      consentSaved: same,
      consentFailed: same,
      micCheckStart: same,
      micOk: same,
      micFailed: same,
      enter: same,
      openDecline: same,
      closeDialog: same,
      attemptEnded: withChecking(entered),
      checkDone: same,
    },
  ],
];

describe("screeningFlowReducer", () => {
  for (const [name, state, expected] of table) {
    describe(`in ${name}`, () => {
      for (const [eventName, event] of Object.entries(events)) {
        const next = expected[eventName];
        it(`${eventName} → ${next === same ? "unchanged" : next.step}`, () => {
          expect(screeningFlowReducer(state, event)).toEqual(next === same ? state : next);
        });
      }
    });
  }

  it("covers every event in the table", () => {
    for (const [, , expected] of table) {
      expect(Object.keys(expected).sort()).toEqual(Object.keys(events).sort());
    }
  });

  it("closes an open dialog and keeps the step", () => {
    const open = withDecline(micFailed);
    expect(screeningFlowReducer(open, { type: "closeDialog" })).toEqual(micFailed);
    expect(screeningFlowReducer(open, { type: "openDialog", dialog: "accommodation" })).toEqual({
      ...micFailed,
      dialog: "accommodation",
    });
  });

  it("keeps the dialog and the polling across step changes", () => {
    const state = { ...micChecking, dialog: "decline" as const, checking: true };
    expect(screeningFlowReducer(state, { type: "micOk" })).toEqual({ ...ready, dialog: "decline", checking: true });
  });

  it("closes the dialog on entering, and polling stops on checkDone", () => {
    const state = withChecking(withDecline(ready));
    const next = screeningFlowReducer(state, { type: "enter" });
    expect(next).toEqual(withChecking(entered));
    expect(screeningFlowReducer(next, { type: "checkDone" })).toEqual(entered);
  });

  it("can't enter without consent or a working microphone", () => {
    for (const state of [consent, saving, unchecked, micChecking, micFailed]) {
      expect(screeningFlowReducer(state, { type: "enter" }).step).not.toBe("entered");
    }
  });
});

describe("initialScreeningFlow", () => {
  it("asks for consent unless the current version is stored", () => {
    expect(initialScreeningFlow({ consented: false, inProgress: false })).toEqual(consent);
    expect(initialScreeningFlow({ consented: true, inProgress: false })).toEqual(unchecked);
  });

  it("reads the status again when an attempt is in progress", () => {
    expect(initialScreeningFlow({ consented: true, inProgress: true })).toEqual(withChecking(unchecked));
  });
});

describe("hasConsented and micStatus", () => {
  it("read the step", () => {
    expect([consent, saving, unchecked, micFailed, ready, entered].map(hasConsented)).toEqual([
      false,
      false,
      true,
      true,
      true,
      true,
    ]);
    expect([consent, unchecked, micChecking, micFailed, ready, entered].map(micStatus)).toEqual([
      "unchecked",
      "unchecked",
      "checking",
      "failed",
      "ok",
      "ok",
    ]);
  });
});
