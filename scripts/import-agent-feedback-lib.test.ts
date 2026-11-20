import { describe, expect, it } from "vitest";
import type { ArizeSpan } from "./arize-lib";
import {
  dedupeBySpan,
  feedbackAnnotation,
  matchFeedback,
  replyOfOutput,
  replyTextOf,
  toChatRoot,
  type ChatRoot,
  type FeedbackRow,
} from "./import-agent-feedback-lib";

const row = (over: Partial<FeedbackRow> = {}): FeedbackRow => ({
  id: "f1",
  session_id: "s1",
  message_id: "msg-a",
  agent_role: "applicant",
  rating: -1,
  reasons: [],
  comment: null,
  created_at: "2026-11-10T12:00:00Z",
  updated_at: "2026-11-10T12:00:00Z",
  ...over,
});

const root = (over: Partial<ChatRoot> = {}): ChatRoot => ({
  spanId: "sp1",
  traceId: "t1",
  startTime: "2026-11-10T11:00:00Z",
  sessionId: "s1",
  turnEnd: "reply",
  ...over,
});

describe("toChatRoot", () => {
  it("reads the ids, the turn end and the reply from a span", () => {
    const span: ArizeSpan = {
      name: "agent-chat",
      context: { trace_id: "t1", span_id: "sp1" },
      start_time: "2026-11-10T11:00:00Z",
      end_time: "2026-11-10T11:00:05Z",
      attributes: {
        "session.id": "s1",
        "gethired.message_id": "msg-a",
        "gethired.turn_end": "paused",
        "output.value": "assistant: Here are three jobs.",
      },
    };
    expect(toChatRoot(span)).toEqual({
      spanId: "sp1",
      traceId: "t1",
      startTime: "2026-11-10T11:00:00Z",
      sessionId: "s1",
      messageId: "msg-a",
      turnEnd: "paused",
      output: "Here are three jobs.",
    });
  });
});

describe("replyOfOutput", () => {
  it("reads the exporter's line and the older serialized messages", () => {
    expect(replyOfOutput("assistant: Here are jobs.")).toBe("Here are jobs.");
    const old = JSON.stringify([
      { role: "assistant", parts: [{ type: "text", content: "Here are" }, { type: "tool_call", id: "c1" }] },
      { role: "assistant", parts: [{ type: "text", content: "some jobs." }] },
    ]);
    expect(replyOfOutput(old)).toBe("Here are\nsome jobs.");
    expect(replyOfOutput("[no reply yet: the turn is waiting]")).toBe("[no reply yet: the turn is waiting]");
    expect(replyOfOutput(undefined)).toBeUndefined();
  });
});

describe("matchFeedback", () => {
  it("matches by message id, preferring the latest turn that ended in a reply", () => {
    const roots = [
      root({ spanId: "first", messageId: "msg-a", turnEnd: "paused", startTime: "2026-11-10T11:00:00Z" }),
      root({ spanId: "answer", messageId: "msg-a", turnEnd: "reply", startTime: "2026-11-10T11:01:00Z" }),
      root({ spanId: "later-paused", messageId: "msg-a", turnEnd: "paused", startTime: "2026-11-10T11:02:00Z" }),
      root({ spanId: "other", messageId: "msg-b" }),
    ];
    expect(matchFeedback(row(), roots, undefined)).toMatchObject({ root: { spanId: "answer" }, by: "message_id" });
  });

  it("takes the latest turn when none ended in a reply", () => {
    const roots = [
      root({ spanId: "a", messageId: "msg-a", turnEnd: "paused", startTime: "2026-11-10T11:00:00Z" }),
      root({ spanId: "b", messageId: "msg-a", turnEnd: "empty", startTime: "2026-11-10T11:05:00Z" }),
    ];
    expect(matchFeedback(row(), roots, undefined)).toMatchObject({ root: { spanId: "b" } });
  });

  it("falls back to the reply text for traces without message ids", () => {
    const roots = [
      root({ spanId: "earlier", output: "Something else entirely, not this reply." }),
      root({ spanId: "this", output: "I found 3 remote React roles for you.", startTime: "2026-11-10T11:30:00Z" }),
    ];
    const text = "Searching now.\nI found 3   remote React roles for you.";
    expect(matchFeedback(row(), roots, text)).toMatchObject({ root: { spanId: "this" }, by: "reply_text" });
  });

  it("matches text with contact details masked, as the exporter masks them", () => {
    const roots = [root({ output: "I emailed the recruiter at [email] about the role." })];
    const text = "I emailed the recruiter at hr@acme.com about the role.";
    expect(matchFeedback(row(), roots, text)).toMatchObject({ by: "reply_text" });
  });

  it("doesn't match short outputs, other sessions, traces with ids, or turns after the vote", () => {
    const text = "Done. I found 3 remote React roles for you.";
    expect(matchFeedback(row(), [root({ output: "Done." })], text).root).toBeNull();
    expect(matchFeedback(row(), [root({ sessionId: "s2", output: text })], text).root).toBeNull();
    expect(matchFeedback(row(), [root({ messageId: "msg-b", output: text })], text).root).toBeNull();
    expect(matchFeedback(row(), [root({ output: text, startTime: "2026-11-10T13:00:00Z" })], text).root).toBeNull();
  });

  it("says why a vote wasn't matched", () => {
    expect(matchFeedback(row(), [], "text")).toMatchObject({ root: null, reason: expect.stringMatching(/no trace/) });
    expect(matchFeedback(row(), [root({ output: "long enough output text" })], undefined)).toMatchObject({
      root: null,
      reason: expect.stringMatching(/no longer stored/),
    });
  });
});

describe("replyTextOf", () => {
  it("joins text parts and skips tools and data parts", () => {
    expect(
      replyTextOf([
        { type: "text", text: "One" },
        { type: "tool-searchJobs", output: { text: "no" } },
        { type: "data-suggestions", data: [] },
        { type: "text", text: "Two" },
      ]),
    ).toBe("One\nTwo");
    expect(replyTextOf(null)).toBe("");
  });
});

describe("feedbackAnnotation", () => {
  it("writes a 👍 as up with no note", () => {
    expect(feedbackAnnotation(row({ rating: 1 }), "sp1", { withComments: true })).toEqual({
      record_id: "sp1",
      values: [{ name: "user_rating", label: "up", score: 1 }],
    });
  });

  it("writes a 👎 with its reasons and a masked comment", () => {
    const record = feedbackAnnotation(
      row({ reasons: ["wrong_info", "bad_matches"], comment: " Call me on +91 98765 43210 or a@b.co " }),
      "sp1",
      { withComments: true },
    );
    expect(record?.values).toEqual([
      { name: "user_rating", label: "down", score: 0 },
      { name: "user_feedback_note", text: "reasons: wrong_info, bad_matches\ncomment: Call me on [phone] or [email]" },
    ]);
  });

  it("leaves the comment out when asked, and skips a row without a vote", () => {
    const record = feedbackAnnotation(row({ comment: "private" }), "sp1", { withComments: false });
    expect(record?.values).toEqual([{ name: "user_rating", label: "down", score: 0 }]);
    expect(feedbackAnnotation(row({ rating: null }), "sp1", { withComments: true })).toBeNull();
  });
});

describe("dedupeBySpan", () => {
  it("keeps the latest updated vote for a span", () => {
    const older = { row: row({ id: "a", updated_at: "2026-11-10T12:00:00Z" }), root: root(), by: "reply_text" as const };
    const newer = { row: row({ id: "b", updated_at: "2026-11-11T12:00:00Z" }), root: root(), by: "reply_text" as const };
    expect(dedupeBySpan([older, newer]).map((m) => m.row.id)).toEqual(["b"]);
  });
});
