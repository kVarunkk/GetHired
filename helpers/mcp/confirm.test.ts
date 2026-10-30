/**
 * Confirmations for the tools the agent always asks about (MCP TASK-060–062,
 * spec §4.6, MCP-SEC-011): the signed state and its single-use claim, then
 * the gate's two paths. Path A asks through MRTR elicitation; path B stores
 * the confirmation and hands the model a short confirmation_token to send
 * back once the user says yes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CLIENT_CAPABILITIES_META_KEY,
  isInputRequiredResult,
  type CallToolResult,
  type ServerContext,
} from "@modelcontextprotocol/server";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { toolContext } from "@/test/utils/tools";
import { reportError } from "@/helpers/posthog/report-error";
import { MCP_CONFIRMATION_TTL_SECONDS } from "./config";
import {
  claimConfirmation,
  confirmationDigest,
  mintConfirmation,
  runConfirmed,
  verifyConfirmation,
  type ConfirmationBinding,
  type ConfirmGate,
} from "./confirm";
import { isOutcomeResult, type McpRunResult } from "./limits";
import type { McpPreview } from "./previews";

vi.mock("@/helpers/posthog/report-error", () => ({ reportError: vi.fn() }));

const SECRET = "test-secret-that-is-at-least-32-bytes-long";
const NOW = new Date("2026-10-28T12:00:00.000Z");
const TOOL = "update_my_preferences";
const INPUT = { desiredRoles: ["Frontend Engineer"] };
const BINDING: ConfirmationBinding = { userId: "u1", tool: TOOL, via: "token" };

const PREVIEW: McpPreview = {
  ok: true,
  summary: "Update your job preferences?",
  details: [{ label: "Desired roles", value: "not set → Frontend Engineer" }],
};
const RAN: CallToolResult = { content: [{ type: "text", text: "{}" }], structuredContent: { updated: true } };

let supabase: SupabaseMock;
let preview: ReturnType<typeof vi.fn<(input: Record<string, unknown>) => Promise<McpPreview>>>;
let run: ReturnType<typeof vi.fn<(input: Record<string, unknown>) => Promise<CallToolResult>>>;

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  vi.stubEnv("MCP_STATE_SECRET", SECRET);
  vi.mocked(reportError).mockClear();
  supabase = createSupabaseMock();
  preview = vi.fn().mockResolvedValue(PREVIEW);
  run = vi.fn().mockResolvedValue(RAN);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

/** A tools/call context: modern with the given capabilities, or legacy (no envelope). */
function request({
  capabilities,
  requestState,
  inputResponses,
}: {
  capabilities?: Record<string, unknown>;
  requestState?: string;
  inputResponses?: Record<string, unknown>;
} = {}) {
  return {
    mcpReq: {
      id: 1,
      method: "tools/call",
      envelope: capabilities ? { [CLIENT_CAPABILITIES_META_KEY]: capabilities } : undefined,
      inputResponses,
      requestState: () => requestState,
    },
  } as unknown as ServerContext;
}

const ELICIT = { elicitation: { form: {} } };

function gate(args: Record<string, unknown>, req: ServerContext): ConfirmGate {
  return {
    ctx: { ...toolContext(supabase.client), surface: "mcp", sessionId: null },
    tool: TOOL,
    args,
    request: req,
    preview,
    run,
  };
}

const unwrap = (value: McpRunResult) =>
  isOutcomeResult(value) ? value : { result: value, outcome: undefined };

const claims = () =>
  supabase
    .callsFor("mcp_confirmations")
    .flatMap((c) => c.chain.filter((step) => step.method === "insert").map((step) => step.args[0]));

const alreadyUsed = () =>
  supabase.queue("mcp_confirmations", { data: null, error: { code: "23505", message: "duplicate key" } });

describe("confirmation state (MCP-SEC-011)", () => {
  it("verifies what it minted, with a fresh jti each time", async () => {
    const first = await verifyConfirmation(await mintConfirmation(BINDING, INPUT), BINDING, INPUT);
    const second = await verifyConfirmation(await mintConfirmation(BINDING, INPUT), BINDING, INPUT);

    expect(first).toMatchObject({ ok: true, jti: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    expect(second.ok && first.ok && second.jti !== first.jti).toBe(true);
  });

  it("doesn't put the user id in the wire value", async () => {
    const state = await mintConfirmation(BINDING, INPUT);
    const body = Buffer.from(state.split(".")[1], "base64url").toString();

    expect(body).not.toContain("u1");
  });

  it("refuses a tampered state", async () => {
    const state = await mintConfirmation(BINDING, INPUT);
    const [prefix, body, mac] = state.split(".");
    const envelope = JSON.parse(Buffer.from(body, "base64url").toString());
    envelope.p.jti = "00000000-0000-4000-8000-000000000000";
    const tampered = [prefix, Buffer.from(JSON.stringify(envelope)).toString("base64url"), mac].join(".");

    expect(await verifyConfirmation(tampered, BINDING, INPUT)).toEqual({ ok: false, reason: "invalid" });
    expect(await verifyConfirmation("not-a-state", BINDING, INPUT)).toEqual({ ok: false, reason: "invalid" });
  });

  it("refuses a state signed with another key", async () => {
    const state = await mintConfirmation(BINDING, INPUT);
    vi.stubEnv("MCP_STATE_SECRET", "another-secret-that-is-also-32-bytes-long");

    expect(await verifyConfirmation(state, BINDING, INPUT)).toEqual({ ok: false, reason: "invalid" });
  });

  it("refuses an expired state", async () => {
    const state = await mintConfirmation(BINDING, INPUT);
    vi.setSystemTime(NOW.getTime() + (MCP_CONFIRMATION_TTL_SECONDS + 1) * 1000);

    expect(await verifyConfirmation(state, BINDING, INPUT)).toEqual({ ok: false, reason: "expired" });
  });

  it.each([
    ["another user's", { ...BINDING, userId: "u2" }, INPUT],
    ["another tool's", { ...BINDING, tool: "complete_onboarding" }, INPUT],
    ["the other path's", { ...BINDING, via: "elicit" as const }, INPUT],
    ["a changed input", BINDING, { desiredRoles: ["Backend Engineer"] }],
  ])("refuses %s state", async (_case, binding, input) => {
    const state = await mintConfirmation(BINDING, INPUT);

    expect(await verifyConfirmation(state, binding, input)).toEqual({ ok: false, reason: "mismatch" });
  });

  it("digests the same input the same way whatever its key order", () => {
    expect(confirmationDigest(BINDING, { a: 1, b: [{ c: 2, d: 3 }] })).toBe(
      confirmationDigest(BINDING, { b: [{ d: 3, c: 2 }], a: 1 }),
    );
  });
});

describe("claimConfirmation", () => {
  it("claims a jti once, for the user and tool, until it expires", async () => {
    expect(await claimConfirmation(supabase.client, { userId: "u1", tool: TOOL, jti: "j1" })).toBe("claimed");

    expect(claims()).toEqual([
      {
        jti: "j1",
        user_id: "u1",
        tool: TOOL,
        expires_at: new Date(NOW.getTime() + MCP_CONFIRMATION_TTL_SECONDS * 1000).toISOString(),
      },
    ]);
  });

  it("reports a used jti when the insert hits the primary key", async () => {
    alreadyUsed();

    expect(await claimConfirmation(supabase.client, { userId: "u1", tool: TOOL, jti: "j1" })).toBe("used");
  });

  it("throws on any other error", async () => {
    supabase.queue("mcp_confirmations", { data: null, error: { code: "42501", message: "denied" } });

    await expect(claimConfirmation(supabase.client, { userId: "u1", tool: TOOL, jti: "j1" })).rejects.toBeTruthy();
  });
});

describe("runConfirmed path A (elicitation)", () => {
  async function firstRound(args: Record<string, unknown> = INPUT) {
    const value = await runConfirmed(gate(args, request({ capabilities: ELICIT })));
    if (!isInputRequiredResult(value)) throw new Error("expected input_required");
    return value;
  }

  it("asks the user with the preview, and runs nothing yet", async () => {
    const result = await firstRound();

    expect(result).toMatchObject({
      resultType: "input_required",
      inputRequests: {
        confirm: {
          method: "elicitation/create",
          params: {
            message: "Update your job preferences?\n- Desired roles: not set → Frontend Engineer",
            requestedSchema: {
              type: "object",
              properties: { confirm: { type: "boolean" } },
              required: ["confirm"],
            },
          },
        },
      },
      requestState: expect.any(String),
    });
    expect(preview).toHaveBeenCalledWith(INPUT);
    expect(run).not.toHaveBeenCalled();
  });

  it.each([{}, { form: {} }])("elicits from a client that declares elicitation %j", async (elicitation) => {
    const value = await runConfirmed(gate(INPUT, request({ capabilities: { elicitation } })));

    expect(isInputRequiredResult(value)).toBe(true);
  });

  it("runs the tool once when the user accepts with confirm: true", async () => {
    const { requestState } = await firstRound();

    const value = await runConfirmed(
      gate(
        INPUT,
        request({
          capabilities: ELICIT,
          requestState,
          inputResponses: { confirm: { action: "accept", content: { confirm: true } } },
        }),
      ),
    );

    expect(value).toBe(RAN);
    expect(run).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith(INPUT);
    expect(claims()).toHaveLength(1);
  });

  it.each([
    ["decline", { action: "decline" }],
    ["cancel", { action: "cancel" }],
    ["confirm: false", { action: "accept", content: { confirm: false } }],
  ])("doesn't run it on %s", async (_case, response) => {
    const { requestState } = await firstRound();

    const { result, outcome } = unwrap(
      await runConfirmed(
        gate(INPUT, request({ capabilities: ELICIT, requestState, inputResponses: { confirm: response } })),
      ),
    );

    expect(outcome).toBe("denied");
    expect((result as CallToolResult).content[0]).toMatchObject({ text: expect.stringMatching(/declined/) });
    expect(run).not.toHaveBeenCalled();
    expect(claims()).toEqual([]);
  });

  it("says it's already done on a replayed retry, without running it again", async () => {
    const { requestState } = await firstRound();
    alreadyUsed();

    const { result, outcome } = unwrap(
      await runConfirmed(
        gate(
          INPUT,
          request({
            capabilities: ELICIT,
            requestState,
            inputResponses: { confirm: { action: "accept", content: { confirm: true } } },
          }),
        ),
      ),
    );

    expect(outcome).toBe("denied");
    expect((result as CallToolResult).content[0]).toMatchObject({ text: expect.stringMatching(/already/) });
    expect(run).not.toHaveBeenCalled();
  });

  it("asks again when the retry's input differs from what the user saw", async () => {
    const { requestState } = await firstRound();

    const value = await runConfirmed(
      gate(
        { desiredRoles: ["Backend Engineer"] },
        request({
          capabilities: ELICIT,
          requestState,
          inputResponses: { confirm: { action: "accept", content: { confirm: true } } },
        }),
      ),
    );

    expect(isInputRequiredResult(value)).toBe(true);
    expect(preview).toHaveBeenLastCalledWith({ desiredRoles: ["Backend Engineer"] });
    expect(run).not.toHaveBeenCalled();
  });

  it("doesn't accept a path B token in place of the user's answer", async () => {
    const token = await mintConfirmation(BINDING, INPUT);

    const value = await runConfirmed(gate({ ...INPUT, confirmation_token: token }, request({ capabilities: ELICIT })));

    expect(isInputRequiredResult(value)).toBe(true);
    expect(run).not.toHaveBeenCalled();
  });

  it("returns the preview's error without asking", async () => {
    preview.mockResolvedValue({ ok: false, error: "Profile not found." });

    const value = await runConfirmed(gate(INPUT, request({ capabilities: ELICIT })));

    expect(value).toMatchObject({ isError: true, content: [{ text: "Profile not found." }] });
    expect(run).not.toHaveBeenCalled();
  });
});

describe("runConfirmed path B (confirmation_token)", () => {
  async function firstRound(req = request()) {
    const { result, outcome } = unwrap(await runConfirmed(gate(INPUT, req)));
    expect(outcome).toBe("needs_confirmation");
    return result as CallToolResult & { structuredContent: { confirmation_token: string } };
  }

  const claimCalls = () => supabase.callsFor("claim_mcp_confirmation").map((c) => c.chain[0].args[1]);
  const claimAs = (reason: string) => supabase.queueRpc("claim_mcp_confirmation", { data: reason, error: null });

  it.each([
    ["a legacy client", request()],
    ["a modern client that can't elicit", request({ capabilities: {} })],
    ["a modern client with URL elicitation only", request({ capabilities: { elicitation: { url: {} } } })],
  ])("returns the preview, a token and the instruction to %s", async (_case, req) => {
    const result = await firstRound(req);

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      needsConfirmation: true,
      preview: "Update your job preferences?\n- Desired roles: not set → Frontend Engineer",
      confirmation_token: expect.any(String),
      instruction: expect.stringMatching(/ask them to confirm.*only after they say yes/),
    });
    expect(JSON.parse((result.content[0] as { text: string }).text)).toEqual(result.structuredContent);
    expect(run).not.toHaveBeenCalled();
  });

  it("stores the confirmation unused and hands out a short token for it", async () => {
    const token = (await firstRound()).structuredContent.confirmation_token;

    expect(token).toMatch(/^[a-hj-km-np-z2-9]{10}$/);
    expect(claims()).toEqual([
      {
        jti: expect.stringMatching(/^[0-9a-f-]{36}$/),
        code: token,
        digest: confirmationDigest(BINDING, INPUT),
        user_id: "u1",
        tool: TOOL,
        used_at: null,
        expires_at: new Date(NOW.getTime() + MCP_CONFIRMATION_TTL_SECONDS * 1000).toISOString(),
      },
    ]);
  });

  it("runs the tool once the token is claimed, without the token in its input", async () => {
    const token = (await firstRound()).structuredContent.confirmation_token;
    claimAs("claimed");

    const value = await runConfirmed(gate({ ...INPUT, confirmation_token: token }, request()));

    expect(value).toBe(RAN);
    expect(run).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith(INPUT);
    expect(claimCalls()).toEqual([{ p_code: token, p_digest: confirmationDigest(BINDING, INPUT) }]);
  });

  it("forgives a token's case and surrounding spaces", async () => {
    const token = (await firstRound()).structuredContent.confirmation_token;
    claimAs("claimed");

    await runConfirmed(gate({ ...INPUT, confirmation_token: ` ${token.toUpperCase()}\n` }, request()));

    expect(claimCalls()).toEqual([{ p_code: token, p_digest: expect.any(String) }]);
    expect(run).toHaveBeenCalledOnce();
  });

  async function refused(args: Record<string, unknown>) {
    const { result, outcome } = unwrap(await runConfirmed(gate(args, request())));
    expect(outcome).toBe("needs_confirmation");
    expect(run).not.toHaveBeenCalled();
    return result as CallToolResult & { structuredContent: { confirmation_token: string; refused: string } };
  }

  it.each([
    ["an unknown or mis-copied token", "invalid", /wasn't recognized.*copied exactly/],
    ["a token for another input", "mismatch", /was for a different input/],
    ["a used token", "used", /already used/],
    ["an expired token", "expired", /expired/],
  ])("refuses %s, with a new preview and token", async (_case, reason, message) => {
    const token = (await firstRound()).structuredContent.confirmation_token;
    claimAs(reason);

    const result = await refused({ ...INPUT, confirmation_token: token });

    expect(result.isError).toBe(true);
    expect(result.structuredContent.refused).toMatch(message);
    expect(result.structuredContent.refused).toMatch(/Here is a new preview and token/);
    expect(result.structuredContent.confirmation_token).not.toBe(token);
    expect(claims()).toHaveLength(2);
  });

  it("digests the input it was sent, so a changed input doesn't claim the previewed one", async () => {
    const token = (await firstRound()).structuredContent.confirmation_token;
    const changed = { desiredRoles: ["Backend Engineer"] };
    claimAs("mismatch");

    await refused({ ...changed, confirmation_token: token });

    expect(claimCalls()).toEqual([{ p_code: token, p_digest: confirmationDigest(BINDING, changed) }]);
    expect(preview).toHaveBeenLastCalledWith(changed);
  });

  it.each([
    ["an old signed token", "v1.eyJwIjp7fX0.abc"],
    ["a path A requestState", "state"],
    ["a token of the wrong length", "abcdefghjkm"],
  ])("refuses %s without asking the database", async (_case, token) => {
    const value = token === "state" ? await mintConfirmation({ ...BINDING, via: "elicit" }, INPUT) : token;

    const result = await refused({ ...INPUT, confirmation_token: value });

    expect(result.structuredContent.refused).toMatch(/wasn't recognized/);
    expect(claimCalls()).toEqual([]);
  });

  it("reads an unexpected answer from the database as unrecognized", async () => {
    supabase.queueRpc("claim_mcp_confirmation", { data: null, error: null });

    const result = await refused({ ...INPUT, confirmation_token: "abcdefghjk" });

    expect(result.structuredContent.refused).toMatch(/wasn't recognized/);
  });

  it("throws when the claim fails, without running the tool", async () => {
    supabase.queueRpc("claim_mcp_confirmation", { data: null, error: { code: "XX000", message: "boom" } });

    await expect(runConfirmed(gate({ ...INPUT, confirmation_token: "abcdefghjk" }, request()))).rejects.toBeTruthy();
    expect(run).not.toHaveBeenCalled();
  });
});

describe("runConfirmed without MCP_STATE_SECRET", () => {
  it("runs nothing and reports the missing secret", async () => {
    vi.stubEnv("MCP_STATE_SECRET", "");

    const value = await runConfirmed(gate(INPUT, request({ capabilities: ELICIT })));

    expect(value).toMatchObject({ isError: true });
    expect(preview).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    expect(reportError).toHaveBeenCalled();
  });
});
