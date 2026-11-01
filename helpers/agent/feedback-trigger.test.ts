import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import {
  AGENT_FEEDBACK_COOLDOWN_DAYS,
  AGENT_FEEDBACK_DISMISSED_COOLDOWN_DAYS,
  AGENT_FEEDBACK_MIN_USER_TURNS,
} from "./config";
import {
  createFinishedToolTracker,
  finishedMilestone,
  shouldOfferFeedback,
  type FeedbackOfferInput,
} from "./feedback-trigger";

const NOW = new Date("2026-11-01T12:00:00.000Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
const MILESTONES = ["submitApplication", "startResumeReview"];

const offer = (overrides: Partial<FeedbackOfferInput> = {}): FeedbackOfferInput => ({
  enabled: true,
  finishReason: "stop",
  stopped: false,
  sessionOffered: false,
  lastOfferedAt: null,
  lastDismissedAt: null,
  userTurns: 1,
  finishedTools: [{ toolName: "submitApplication", output: { ok: true } }],
  milestones: MILESTONES,
  now: NOW,
  ...overrides,
});

describe("the tunables", () => {
  it("ship as the spec sets them (AF-DEC-001)", () => {
    expect(AGENT_FEEDBACK_COOLDOWN_DAYS).toBe(14);
    expect(AGENT_FEEDBACK_DISMISSED_COOLDOWN_DAYS).toBe(30);
    expect(AGENT_FEEDBACK_MIN_USER_TURNS).toBe(8);
  });
});

describe("finishedMilestone", () => {
  it("counts a milestone that finished without an error", () => {
    expect(finishedMilestone([{ toolName: "submitApplication", output: { ok: true } }], MILESTONES)).toBe(true);
  });

  it("doesn't count a milestone that returned { error }", () => {
    expect(
      finishedMilestone([{ toolName: "submitApplication", output: { error: "Already applied." } }], MILESTONES),
    ).toBe(false);
  });

  it("doesn't count a tool that isn't a milestone", () => {
    expect(finishedMilestone([{ toolName: "searchJobs", output: { jobs: [] } }], MILESTONES)).toBe(false);
  });
});

describe("shouldOfferFeedback", () => {
  it("offers after a milestone", () => {
    expect(shouldOfferFeedback(offer())).toBe(true);
  });

  it("is off with the kill switch", () => {
    expect(shouldOfferFeedback(offer({ enabled: false }))).toBe(false);
  });

  it.each(["tool-calls", "length", "content-filter", "error", undefined])(
    "doesn't offer when the turn finished with %s",
    (finishReason) => {
      expect(shouldOfferFeedback(offer({ finishReason }))).toBe(false);
    },
  );

  it("doesn't offer on a stopped turn", () => {
    expect(shouldOfferFeedback(offer({ stopped: true }))).toBe(false);
  });

  it("doesn't offer twice in a session", () => {
    expect(shouldOfferFeedback(offer({ sessionOffered: true }))).toBe(false);
  });

  it("waits 14 days after the last offer", () => {
    expect(shouldOfferFeedback(offer({ lastOfferedAt: daysAgo(13) }))).toBe(false);
    expect(shouldOfferFeedback(offer({ lastOfferedAt: daysAgo(15) }))).toBe(true);
  });

  it("waits 30 days after a dismissal", () => {
    expect(shouldOfferFeedback(offer({ lastDismissedAt: daysAgo(29) }))).toBe(false);
    expect(shouldOfferFeedback(offer({ lastDismissedAt: daysAgo(31) }))).toBe(true);
  });

  it("doesn't offer for a milestone that failed or a tool that isn't one", () => {
    expect(
      shouldOfferFeedback(offer({ finishedTools: [{ toolName: "submitApplication", output: { error: "x" } }] })),
    ).toBe(false);
    expect(shouldOfferFeedback(offer({ finishedTools: [{ toolName: "searchJobs", output: {} }] }))).toBe(false);
  });

  it("offers in a long session without a milestone: 7 turns no, 8 yes", () => {
    expect(shouldOfferFeedback(offer({ finishedTools: [], userTurns: 7 }))).toBe(false);
    expect(shouldOfferFeedback(offer({ finishedTools: [], userTurns: 8 }))).toBe(true);
  });

  it("offers once when both triggers hold", () => {
    expect(shouldOfferFeedback(offer({ userTurns: 12 }))).toBe(true);
  });
});

describe("createFinishedToolTracker", () => {
  it("collects tools that finished in the stream, skipping errors, denials and previews", () => {
    const tracker = createFinishedToolTracker(undefined);
    tracker.observe({ type: "tool-input-start", toolCallId: "c1", toolName: "searchJobs" });
    tracker.observe({ type: "tool-input-available", toolCallId: "c1", toolName: "searchJobs", input: {} });
    tracker.observe({ type: "tool-output-available", toolCallId: "c1", output: { jobs: [] } });
    tracker.observe({ type: "tool-input-available", toolCallId: "c2", toolName: "startResumeReview", input: {} });
    tracker.observe({ type: "tool-output-available", toolCallId: "c2", output: { partial: true }, preliminary: true });
    tracker.observe({ type: "tool-output-error", toolCallId: "c2", errorText: "boom" });
    tracker.observe({ type: "tool-input-available", toolCallId: "c3", toolName: "submitApplication", input: {} });
    tracker.observe({ type: "tool-output-denied", toolCallId: "c3" });

    expect(tracker.finished()).toEqual([{ toolName: "searchJobs", output: { jobs: [] } }]);
  });

  it("names a call approved in the previous request from the reply being continued", () => {
    const continued = {
      id: "a1",
      role: "assistant",
      parts: [
        {
          type: "tool-submitApplication",
          toolCallId: "c9",
          state: "approval-responded",
          input: {},
          approval: { id: "ap", approved: true },
        },
      ],
    } as unknown as UIMessage;
    const tracker = createFinishedToolTracker(continued);

    tracker.observe({ type: "tool-output-available", toolCallId: "c9", output: { ok: true } });

    expect(finishedMilestone(tracker.finished(), MILESTONES)).toBe(true);
  });
});
