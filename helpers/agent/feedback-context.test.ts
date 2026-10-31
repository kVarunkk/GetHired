/**
 * AFT-000 / AFT-034: the server's data parts (the suggestions and the survey
 * card) are saved with the reply but never reach the model (AF-REQ-012a), and
 * the client can't add or drop them (AF-REQ-032).
 */
import { describe, expect, it } from "vitest";
import { convertToModelMessages, type UIMessage } from "ai";
import { mergeClientUpdates } from "./client-updates";
import { dropAbandonedToolCalls, selectContextMessages } from "./context";
import { upsertMessages } from "./persistence";
import { FEEDBACK_PART } from "./feedback-trigger";
import { createSupabaseMock } from "@/test/utils/supabase-mock";

const reply: UIMessage = {
  id: "a1",
  role: "assistant",
  parts: [
    { type: "text", text: "Here are three jobs.", state: "done" },
    { type: "data-suggestions", id: "suggestions", data: { suggestions: ["Show more"] } },
    { ...FEEDBACK_PART, data: { ...FEEDBACK_PART.data } },
  ] as UIMessage["parts"],
};
const history: UIMessage[] = [
  { id: "u1", role: "user", parts: [{ type: "text", text: "find jobs" }] },
  reply,
  { id: "u2", role: "user", parts: [{ type: "text", text: "thanks" }] },
];

describe("data parts and the model's context", () => {
  it("converts a reply with suggestions and the survey card to its text only", async () => {
    const context = selectContextMessages(dropAbandonedToolCalls(history), null, {
      window: 20,
      fullToolTurns: 4,
    });
    const messages = await convertToModelMessages(context);

    const serialized = JSON.stringify(messages);
    expect(serialized).not.toContain("data-feedback");
    expect(serialized).not.toContain("data-suggestions");
    expect(serialized).not.toContain("Show more");
    expect(messages[1]).toEqual({
      role: "assistant",
      content: [{ type: "text", text: "Here are three jobs." }],
    });
  });
});

describe("data parts when the reply is saved and continued", () => {
  it("saves the survey card with the reply", async () => {
    const supabase = createSupabaseMock();

    await upsertMessages(supabase.client, "s1", "u1", [reply]);

    const [rows] = supabase.callsFor("agent_messages")[0].chain[0].args as [{ parts: unknown[] }[]];
    expect(rows[0].parts).toContainEqual({ type: "data-feedback", id: "feedback", data: { v: 1 } });
  });

  it("keeps the stored card when the client resubmits the reply without it", () => {
    const resubmitted = { ...reply, parts: reply.parts.slice(0, 1) };

    expect(mergeClientUpdates(reply, resubmitted).parts).toEqual(reply.parts);
  });

  it("doesn't take a card the client added", () => {
    const stored = { ...reply, parts: reply.parts.slice(0, 1) };
    const forged = { ...stored, parts: [...stored.parts, { ...FEEDBACK_PART }] } as UIMessage;

    expect(mergeClientUpdates(stored, forged).parts).toEqual(stored.parts);
  });
});
