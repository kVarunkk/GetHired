import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockUser, setRequestUser } from "@/test/utils/auth";
import { flushAfter } from "@/test/utils/after";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { eventCaptureServer } from "@/helpers/posthog/EventCaptureServer";
import { removeAgentFeedbackAction, submitAgentFeedbackAction } from "./submit-agent-feedback";

vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/helpers/posthog/EventCaptureServer", () => ({ eventCaptureServer: vi.fn() }));
vi.mock("@/helpers/posthog/report-error", () => ({ reportError: vi.fn() }));
vi.mock("@/helpers/billing/entitlements", () => ({ consumeEntitlement: vi.fn() }));
vi.mock("@/helpers/ai/deduct-user-credits", () => ({ deductUserCreditsHelper: vi.fn() }));

const SESSION = "11111111-1111-4111-8111-111111111111";
const MESSAGE = "msg-abc";
const user = mockUser();

let supabase: SupabaseMock;

const REPLY_TEXT = "Here are three remote frontend jobs I found for you.";

function storedReply({
  role = "assistant",
  withFeedback = false,
}: { role?: string; withFeedback?: boolean } = {}) {
  return {
    data: {
      role,
      seq: 7,
      metadata: { stopped: true },
      parts: [
        { type: "step-start" },
        { type: "tool-searchJobs", toolCallId: "c1", state: "output-available", input: {}, output: {} },
        { type: "tool-searchJobs", toolCallId: "c2", state: "output-available", input: {}, output: {} },
        { type: "tool-getJobDetails", toolCallId: "c3", state: "output-available", input: {}, output: {} },
        { type: "text", text: REPLY_TEXT, state: "done" },
        ...(withFeedback ? [{ type: "data-feedback", id: "feedback", data: { v: 1 } }] : []),
      ],
    },
    error: null,
  };
}

const writes = () =>
  supabase
    .callsFor("agent_feedback")
    .filter((call) => call.chain.some((c) => ["insert", "update", "upsert", "delete"].includes(c.method)));
const upsertArgs = () => writes()[0].chain.find((c) => c.method === "upsert")!.args;

beforeEach(async () => {
  vi.clearAllMocks();
  await flushAfter();
  supabase = createSupabaseMock({ user });
  await setRequestUser(user, supabase.client);
});

describe("submitAgentFeedbackAction", () => {
  it("refuses without a signed-in user and runs no query", async () => {
    await setRequestUser(null);

    const result = await submitAgentFeedbackAction({ sessionId: SESSION, messageId: MESSAGE, kind: "reply", rating: 1 });

    expect(result).toEqual({ ok: false, error: "Sign in to send feedback." });
    expect(supabase.calls).toHaveLength(0);
  });

  it("refuses an account with no agent role", async () => {
    await setRequestUser({ ...user, app_metadata: {} });

    const result = await submitAgentFeedbackAction({ sessionId: SESSION, messageId: MESSAGE, kind: "reply", rating: 1 });

    expect(result.ok).toBe(false);
    expect(supabase.calls).toHaveLength(0);
  });

  it("refuses a user id in the input (strict schema)", async () => {
    const result = await submitAgentFeedbackAction({
      sessionId: SESSION,
      messageId: MESSAGE,
      kind: "reply",
      rating: 1,
      userId: "00000000-0000-4000-8000-000000000999",
    });

    expect(result.ok).toBe(false);
    expect(supabase.calls).toHaveLength(0);
  });

  it("saves a 👍 for the session user, keyed on user, message and kind", async () => {
    supabase.queue("agent_messages", storedReply());

    const result = await submitAgentFeedbackAction({ sessionId: SESSION, messageId: MESSAGE, kind: "reply", rating: 1 });

    expect(result).toEqual({ ok: true });
    const lookup = supabase.callsFor("agent_messages")[0].chain;
    expect(lookup).toContainEqual({ method: "eq", args: ["id", MESSAGE] });
    expect(lookup).toContainEqual({ method: "eq", args: ["session_id", SESSION] });
    const [row, options] = upsertArgs();
    expect(row).toEqual({
      user_id: user.id,
      session_id: SESSION,
      message_id: MESSAGE,
      agent_role: "applicant",
      kind: "reply",
      rating: 1,
      dismissed: false,
      reasons: [],
      comment: null,
      context: { seq: 7, tools: ["searchJobs", "getJobDetails"], stopped: true, chars: REPLY_TEXT.length },
    });
    expect(options).toEqual({ onConflict: "user_id,message_id,kind" });
  });

  it("builds the context from the stored row, never the reply text", async () => {
    supabase.queue("agent_messages", storedReply());

    await submitAgentFeedbackAction({
      sessionId: SESSION,
      messageId: MESSAGE,
      kind: "reply",
      rating: -1,
      reasons: ["wrong_info"],
      comment: "The salaries were made up",
    });

    const [row] = upsertArgs() as [{ context: unknown; agent_role: string }];
    expect(JSON.stringify(row.context)).not.toContain("remote frontend");
    expect(row.agent_role).toBe("applicant");
  });

  it("saves a switch from 👍 to 👎 as one upsert that clears old details", async () => {
    supabase.queue("agent_messages", storedReply());

    await submitAgentFeedbackAction({ sessionId: SESSION, messageId: MESSAGE, kind: "reply", rating: -1 });

    expect(writes()).toHaveLength(1);
    expect(upsertArgs()[0]).toMatchObject({ rating: -1, reasons: [], comment: null });
  });

  it("answers that the reply is gone when it isn't in that session (or isn't the user's)", async () => {
    supabase.queue("agent_messages", { data: null, error: null });

    const result = await submitAgentFeedbackAction({ sessionId: SESSION, messageId: MESSAGE, kind: "reply", rating: 1 });

    expect(result).toEqual({ ok: false, error: "That reply is no longer in this chat." });
    expect(writes()).toHaveLength(0);
  });

  it("refuses feedback on a user message", async () => {
    supabase.queue("agent_messages", storedReply({ role: "user" }));

    const result = await submitAgentFeedbackAction({ sessionId: SESSION, messageId: MESSAGE, kind: "reply", rating: 1 });

    expect(result.ok).toBe(false);
    expect(writes()).toHaveLength(0);
  });

  it("refuses a survey on a reply without a data-feedback part", async () => {
    supabase.queue("agent_messages", storedReply());

    const result = await submitAgentFeedbackAction({ sessionId: SESSION, messageId: MESSAGE, kind: "survey", rating: 4 });

    expect(result.ok).toBe(false);
    expect(writes()).toHaveLength(0);
  });

  it("saves a survey answer and a dismissal on a reply that carries the card", async () => {
    supabase.queue("agent_messages", storedReply({ withFeedback: true }));
    expect(
      await submitAgentFeedbackAction({
        sessionId: SESSION,
        messageId: MESSAGE,
        kind: "survey",
        rating: 5,
        reasons: ["saved_time"],
      }),
    ).toEqual({ ok: true });
    expect(upsertArgs()[0]).toMatchObject({ kind: "survey", rating: 5, dismissed: false, reasons: ["saved_time"] });

    supabase = createSupabaseMock({ user });
    await setRequestUser(user, supabase.client);
    supabase.queue("agent_messages", storedReply({ withFeedback: true }));
    expect(
      await submitAgentFeedbackAction({ sessionId: SESSION, messageId: MESSAGE, kind: "survey", dismissed: true }),
    ).toEqual({ ok: true });
    expect(upsertArgs()[0]).toMatchObject({ kind: "survey", rating: null, dismissed: true });
  });

  it("uses the company role and its reasons for a company user", async () => {
    const company = mockUser({ type: "company" });
    await setRequestUser(company, supabase.client);
    supabase.queue("agent_messages", storedReply());

    const result = await submitAgentFeedbackAction({
      sessionId: SESSION,
      messageId: MESSAGE,
      kind: "reply",
      rating: -1,
      reasons: ["bad_candidate_matches"],
    });

    expect(result).toEqual({ ok: true });
    expect(upsertArgs()[0]).toMatchObject({ agent_role: "company", reasons: ["bad_candidate_matches"] });
  });

  it("reports a failed save without throwing", async () => {
    supabase.queue("agent_messages", storedReply());
    supabase.queue("agent_feedback", { data: null, error: { message: "boom" } });

    const result = await submitAgentFeedbackAction({ sessionId: SESSION, messageId: MESSAGE, kind: "reply", rating: 1 });

    expect(result).toEqual({ ok: false, error: "Couldn't save your feedback. Please try again." });
    await flushAfter();
    expect(eventCaptureServer).not.toHaveBeenCalled();
  });

  it("doesn't use credits or the message allowance", async () => {
    const { consumeEntitlement } = await import("@/helpers/billing/entitlements");
    const { deductUserCreditsHelper } = await import("@/helpers/ai/deduct-user-credits");
    supabase.queue("agent_messages", storedReply());

    await submitAgentFeedbackAction({ sessionId: SESSION, messageId: MESSAGE, kind: "reply", rating: 1 });

    expect(consumeEntitlement).not.toHaveBeenCalled();
    expect(deductUserCreditsHelper).not.toHaveBeenCalled();
    expect(supabase.calls.map((c) => c.target)).toEqual(["agent_messages", "agent_feedback"]);
  });
});

describe("removeAgentFeedbackAction", () => {
  it("deletes only the user's reply row", async () => {
    supabase.queue("agent_messages", storedReply());

    const result = await removeAgentFeedbackAction({ sessionId: SESSION, messageId: MESSAGE });

    expect(result).toEqual({ ok: true });
    const chain = writes()[0].chain;
    expect(chain).toContainEqual({ method: "delete", args: [] });
    expect(chain).toContainEqual({ method: "eq", args: ["user_id", user.id] });
    expect(chain).toContainEqual({ method: "eq", args: ["message_id", MESSAGE] });
    expect(chain).toContainEqual({ method: "eq", args: ["kind", "reply"] });
  });

  it("refuses without a user, and answers when the reply is gone", async () => {
    await setRequestUser(null);
    expect((await removeAgentFeedbackAction({ sessionId: SESSION, messageId: MESSAGE })).ok).toBe(false);

    await setRequestUser(user, supabase.client);
    supabase.queue("agent_messages", { data: null, error: null });
    expect(await removeAgentFeedbackAction({ sessionId: SESSION, messageId: MESSAGE })).toEqual({
      ok: false,
      error: "That reply is no longer in this chat.",
    });
    expect(writes()).toHaveLength(0);
  });
});

describe("the agent_feedback event", () => {
  it("is sent on a set, without the comment text", async () => {
    supabase.queue("agent_messages", storedReply());

    await submitAgentFeedbackAction({
      sessionId: SESSION,
      messageId: MESSAGE,
      kind: "reply",
      rating: -1,
      reasons: ["wrong_info", "too_long"],
      comment: "secret comment text",
    });
    await flushAfter();

    expect(eventCaptureServer).toHaveBeenCalledWith({
      event: "agent_feedback",
      distinctId: user.id,
      properties: {
        role: "applicant",
        kind: "reply",
        rating: -1,
        dismissed: false,
        reasons: ["wrong_info", "too_long"],
        has_comment: true,
        session_id: SESSION,
        message_id: MESSAGE,
        tools: ["searchJobs", "getJobDetails"],
        action: "set",
      },
    });
    expect(JSON.stringify(vi.mocked(eventCaptureServer).mock.calls)).not.toContain("secret comment text");
  });

  it("is sent on a remove", async () => {
    supabase.queue("agent_messages", storedReply());

    await removeAgentFeedbackAction({ sessionId: SESSION, messageId: MESSAGE });
    await flushAfter();

    expect(eventCaptureServer).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "agent_feedback",
        properties: expect.objectContaining({ action: "remove", kind: "reply", rating: null, has_comment: false }),
      }),
    );
  });

  it("isn't sent on a refused call", async () => {
    supabase.queue("agent_messages", storedReply({ role: "user" }));

    await submitAgentFeedbackAction({ sessionId: SESSION, messageId: MESSAGE, kind: "reply", rating: 1 });
    await flushAfter();

    expect(eventCaptureServer).not.toHaveBeenCalled();
  });
});
