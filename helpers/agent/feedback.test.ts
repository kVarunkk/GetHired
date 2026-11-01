import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import { AGENT_CONTENT_FILTER_MESSAGE } from "./config";
import { RA_CONTENT_FILTER_MESSAGE } from "./roles/recruiter/config";
import {
  agentFeedbackInputSchema,
  canRateReply,
  FEEDBACK_REASONS,
  feedbackStateFromRows,
  hasFeedbackPart,
  reasonsFor,
  SURVEY_POSITIVE_REASONS,
} from "./feedback";

const SESSION = "11111111-1111-4111-8111-111111111111";
const base = { sessionId: SESSION, messageId: "msg-1" };
const keys = (list: readonly { key: string }[]) => list.map((r) => r.key);

describe("reason lists", () => {
  it("gives each role the shared reasons plus its own", () => {
    expect(keys(FEEDBACK_REASONS.applicant)).toEqual([
      "wrong_info",
      "didnt_follow",
      "too_long",
      "too_slow",
      "tool_failed",
      "bad_job_matches",
      "other",
    ]);
    expect(keys(FEEDBACK_REASONS.company)).toEqual([
      "wrong_info",
      "didnt_follow",
      "too_long",
      "too_slow",
      "tool_failed",
      "bad_candidate_matches",
      "other",
    ]);
  });

  it("returns the positive list on request", () => {
    expect(reasonsFor("applicant", { positive: true })).toBe(SURVEY_POSITIVE_REASONS);
    expect(keys(SURVEY_POSITIVE_REASONS)).toEqual(["saved_time", "accurate", "easy", "other"]);
    expect(reasonsFor("company")).toBe(FEEDBACK_REASONS.company);
  });
});

describe("agentFeedbackInputSchema", () => {
  const applicant = agentFeedbackInputSchema("applicant");
  const company = agentFeedbackInputSchema("company");

  it("accepts a reply rated ±1 with the role's reasons", () => {
    expect(applicant.safeParse({ ...base, kind: "reply", rating: 1 }).success).toBe(true);
    expect(
      applicant.safeParse({ ...base, kind: "reply", rating: -1, reasons: ["bad_job_matches", "other"] })
        .success,
    ).toBe(true);
    expect(
      company.safeParse({ ...base, kind: "reply", rating: -1, reasons: ["bad_candidate_matches"] }).success,
    ).toBe(true);
  });

  it("refuses the other role's reason", () => {
    expect(
      company.safeParse({ ...base, kind: "reply", rating: -1, reasons: ["bad_job_matches"] }).success,
    ).toBe(false);
    expect(
      applicant.safeParse({ ...base, kind: "reply", rating: -1, reasons: ["bad_candidate_matches"] })
        .success,
    ).toBe(false);
  });

  it.each([0, 2, undefined])("refuses a reply rated %s", (rating) => {
    expect(applicant.safeParse({ ...base, kind: "reply", rating }).success).toBe(false);
  });

  it("refuses a dismissed reply", () => {
    expect(applicant.safeParse({ ...base, kind: "reply", rating: 1, dismissed: true }).success).toBe(false);
  });

  it("accepts a survey rated 1–5 or dismissed", () => {
    for (const rating of [1, 3, 5]) {
      expect(applicant.safeParse({ ...base, kind: "survey", rating }).success).toBe(true);
    }
    expect(applicant.safeParse({ ...base, kind: "survey", dismissed: true }).success).toBe(true);
  });

  it.each([0, 6])("refuses a survey rated %s", (rating) => {
    expect(applicant.safeParse({ ...base, kind: "survey", rating }).success).toBe(false);
  });

  it("refuses a dismissed survey with a rating or reasons, and a survey with neither", () => {
    expect(applicant.safeParse({ ...base, kind: "survey", dismissed: true, rating: 3 }).success).toBe(false);
    expect(
      applicant.safeParse({ ...base, kind: "survey", dismissed: true, reasons: ["other"] }).success,
    ).toBe(false);
    expect(applicant.safeParse({ ...base, kind: "survey" }).success).toBe(false);
  });

  it("takes positive reasons for 4–5 and negative ones for 1–3", () => {
    expect(applicant.safeParse({ ...base, kind: "survey", rating: 5, reasons: ["saved_time"] }).success).toBe(
      true,
    );
    expect(applicant.safeParse({ ...base, kind: "survey", rating: 2, reasons: ["saved_time"] }).success).toBe(
      false,
    );
    expect(applicant.safeParse({ ...base, kind: "survey", rating: 2, reasons: ["too_slow"] }).success).toBe(
      true,
    );
    expect(applicant.safeParse({ ...base, kind: "survey", rating: 4, reasons: ["too_slow"] }).success).toBe(
      false,
    );
  });

  it("refuses an unknown key, seven reasons and duplicates", () => {
    expect(applicant.safeParse({ ...base, kind: "reply", rating: -1, reasons: ["nope"] }).success).toBe(false);
    expect(
      applicant.safeParse({
        ...base,
        kind: "reply",
        rating: -1,
        reasons: keys(FEEDBACK_REASONS.applicant),
      }).success,
    ).toBe(false);
    expect(
      applicant.safeParse({ ...base, kind: "reply", rating: -1, reasons: ["other", "other"] }).success,
    ).toBe(false);
  });

  it("refuses extra fields such as a user id", () => {
    expect(applicant.safeParse({ ...base, kind: "reply", rating: 1, userId: "someone" }).success).toBe(false);
  });

  it("caps the comment at 2000 characters after trimming, and drops an empty one", () => {
    expect(
      applicant.safeParse({ ...base, kind: "reply", rating: -1, comment: "x".repeat(2001) }).success,
    ).toBe(false);
    const trimmed = applicant.parse({ ...base, kind: "reply", rating: -1, comment: `  ${"x".repeat(2000)}  ` });
    expect(trimmed.comment).toHaveLength(2000);
    expect(applicant.parse({ ...base, kind: "reply", rating: -1, comment: "   " }).comment).toBeUndefined();
  });

  it("refuses a bad session id or a long message id", () => {
    expect(applicant.safeParse({ ...base, sessionId: "nope", kind: "reply", rating: 1 }).success).toBe(false);
    expect(
      applicant.safeParse({ ...base, messageId: "m".repeat(65), kind: "reply", rating: 1 }).success,
    ).toBe(false);
  });
});

describe("feedbackStateFromRows", () => {
  it("maps reply, answered survey and dismissed survey rows", () => {
    expect(
      feedbackStateFromRows([
        { message_id: "a", kind: "reply", rating: 1, dismissed: false },
        { message_id: "a", kind: "survey", rating: 4, dismissed: false },
        { message_id: "b", kind: "reply", rating: -1, dismissed: false },
        { message_id: "c", kind: "survey", rating: null, dismissed: true },
      ]),
    ).toEqual({
      a: { reply: 1, survey: "answered" },
      b: { reply: -1 },
      c: { survey: "dismissed" },
    });
  });

  it("is empty without rows", () => {
    expect(feedbackStateFromRows([])).toEqual({});
  });
});

describe("canRateReply", () => {
  const reply = (parts: UIMessage["parts"], metadata?: unknown): UIMessage =>
    ({ id: "r", role: "assistant", parts, ...(metadata ? { metadata } : {}) }) as UIMessage;
  const text = (t: string) => ({ type: "text" as const, text: t, state: "done" as const });

  it("allows a finished reply with text", () => {
    expect(canRateReply(reply([text("Here you go")]), { streaming: false })).toBe(true);
  });

  it("allows a stopped reply", () => {
    expect(canRateReply(reply([text("Partial")], { stopped: true }), { streaming: false })).toBe(true);
  });

  it("hides while streaming", () => {
    expect(canRateReply(reply([text("Here")]), { streaming: true })).toBe(false);
  });

  it("hides on a user message", () => {
    expect(canRateReply({ id: "u", role: "user", parts: [text("hi")] }, { streaming: false })).toBe(false);
  });

  it("hides a reply with no text", () => {
    expect(canRateReply(reply([text("  ")]), { streaming: false })).toBe(false);
    expect(
      canRateReply(
        reply([
          {
            type: "tool-searchJobs",
            toolCallId: "c1",
            state: "output-available",
            input: {},
            output: {},
          } as UIMessage["parts"][number],
        ]),
        { streaming: false },
      ),
    ).toBe(false);
  });

  it("hides a reply waiting on an approval or an upload", () => {
    const approval = {
      type: "tool-submitApplication",
      toolCallId: "c1",
      state: "approval-requested",
      input: {},
      approval: { id: "a1" },
    } as UIMessage["parts"][number];
    const upload = {
      type: "tool-requestResumeUpload",
      toolCallId: "c2",
      state: "input-available",
      input: {},
    } as UIMessage["parts"][number];
    expect(canRateReply(reply([text("Shall I apply?"), approval]), { streaming: false })).toBe(false);
    expect(canRateReply(reply([text("Upload it here"), upload]), { streaming: false })).toBe(false);
  });

  it("hides the content-filter message for either role", () => {
    expect(canRateReply(reply([text(AGENT_CONTENT_FILTER_MESSAGE)]), { streaming: false })).toBe(false);
    expect(canRateReply(reply([text(RA_CONTENT_FILTER_MESSAGE)]), { streaming: false })).toBe(false);
  });
});

describe("hasFeedbackPart", () => {
  it("finds a data-feedback part", () => {
    expect(hasFeedbackPart([{ type: "text" }, { type: "data-feedback" }])).toBe(true);
    expect(hasFeedbackPart([{ type: "data-suggestions" }])).toBe(false);
  });
});
