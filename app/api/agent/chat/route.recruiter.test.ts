import { beforeEach, describe, expect, it, vi } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import type { UIMessage } from "ai";
import { POST } from "./route";
import { buildRequest } from "@/test/utils/request";
import { setRequestUser } from "@/test/utils/auth";
import { flushAfter } from "@/test/utils/after";
import { mockModel, textStream } from "@/test/utils/ai";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A } from "@/test/utils/recruiter";
import { google } from "@ai-sdk/google";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { generateSessionTitle, summariseSession } from "@/helpers/agent/summarise";
import { generateFollowUps } from "@/helpers/agent/suggestions";
import { eventCaptureServer } from "@/helpers/posthog/EventCaptureServer";
import { agentTelemetry, flushAgentTraces } from "@/helpers/agent/telemetry";
import { consumeEntitlement, getEntitlements } from "@/helpers/billing/entitlements";
import { EntitlementError } from "@/helpers/billing/errors";
import { RA_DAILY_MESSAGE_CAP } from "@/helpers/agent/roles/recruiter/config";

vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@ai-sdk/google", () => ({ google: vi.fn() }));
vi.mock("@/helpers/agent/summarise", () => ({
  generateSessionTitle: vi.fn(),
  summariseSession: vi.fn(),
}));
vi.mock("@/helpers/agent/suggestions", () => ({ generateFollowUps: vi.fn() }));
vi.mock("@/helpers/posthog/EventCaptureServerException", () => ({
  eventCaptureServerException: vi.fn(),
}));
vi.mock("@/helpers/posthog/EventCaptureServer", () => ({ eventCaptureServer: vi.fn() }));
vi.mock("@/helpers/agent/telemetry", () => ({
  agentTelemetry: vi.fn(),
  flushAgentTraces: vi.fn(),
}));
vi.mock("@/helpers/billing/entitlements", () => ({
  consumeEntitlement: vi.fn(),
  getEntitlements: vi.fn(),
}));

const SESSION_ID = "55555555-5555-4555-8555-555555555555";
const USER_ID = COMPANY_A.user.id;
const SESSION = {
  id: SESSION_ID,
  user_id: USER_ID,
  role: "company",
  title: "New chat",
  summary: null,
  summary_upto_message_id: null,
  created_at: "c",
  updated_at: "u",
};
const JOB = {
  id: "b0000000-0000-4000-8000-000000000001",
  title: "Founding Backend Engineer",
  status: "active",
  matching_status: "completed",
  applicants: 3,
  new_24h: 1,
  created_at: "c",
  updated_at: "u",
};

const text = (id: string, role: "user" | "assistant", value: string): UIMessage => ({
  id,
  role,
  parts: [{ type: "text", text: value }],
});
const asRow = (m: UIMessage) => ({ id: m.id, role: m.role, parts: m.parts, metadata: m.metadata ?? null });

let supabase: SupabaseMock;
let model: MockLanguageModelV4;

const chat = (body: unknown) => POST(buildRequest("/api/agent/chat", { method: "POST", body }));
const submit = (message: UIMessage) => chat({ sessionId: SESSION_ID, trigger: "submit-message", message });

/** The reads a company user's accepted turn makes. */
function queueTurn({
  history = [] as UIMessage[],
  session = SESSION as Record<string, unknown>,
  todayCount = 0,
  countCheck = true,
} = {}) {
  supabase.queue("agent_sessions", { data: session, error: null });
  supabase.queue("agent_messages", { data: history.map(asRow), error: null });
  if (countCheck) supabase.queue("agent_messages", { data: null, error: null, count: todayCount });
  supabase.queueRpc("get_recruiter_job_summaries", { data: [JOB], error: null });
  supabase.queue("agent_memories", { data: [], error: null });
}

const firstPrompt = () => JSON.stringify(model.doStreamCalls[0].prompt);
const toolNames = () => (model.doStreamCalls[0].tools ?? []).map((t) => t.name);

beforeEach(async () => {
  vi.clearAllMocks();
  supabase = createSupabaseMock();
  // requireAgentUser's company lookup.
  supabase.queue("company_info", {
    data: { id: COMPANY_A.id, name: "Acme", email: "hr@acme.dev" },
    error: null,
  });
  await setRequestUser(COMPANY_A.user, supabase.client);
  vi.mocked(createServiceRoleClient).mockReturnValue(createSupabaseMock().client);
  model = mockModel([textStream("Here are your candidates")]);
  vi.mocked(google).mockReturnValue(model as never);
  vi.mocked(generateSessionTitle).mockResolvedValue("Backend hiring");
  vi.mocked(summariseSession).mockResolvedValue({ updated: false });
  vi.mocked(generateFollowUps).mockResolvedValue([]);
  vi.mocked(agentTelemetry).mockImplementation((functionId) => ({ isEnabled: false, functionId }));
  vi.mocked(flushAgentTraces).mockResolvedValue(undefined);
  vi.mocked(consumeEntitlement).mockResolvedValue({ source: "allowance", creditsSpent: 0, duplicate: false });
  vi.mocked(getEntitlements).mockResolvedValue({
    tier: { id: "t", slug: "startup", name: "Startup" },
    creditBalance: 5,
    entitlements: {},
  } as never);
});

describe("POST /api/agent/chat for a company user (RA-TEST-007)", () => {
  it("runs the recruiter prompt and tools, not the applicant ones", async () => {
    queueTurn();

    const res = await submit(text("u1", "user", "find backend candidates"));
    await res.text();

    expect(res.status).toBe(200);
    const prompt = firstPrompt();
    expect(prompt).toContain("GetHired hiring assistant for Acme");
    expect(prompt).toContain("Founding Backend Engineer");
    expect(prompt).not.toContain("job-search assistant");
    expect(toolNames()).toContain("searchCandidates");
    expect(toolNames()).toContain("createJobPost");
    expect(toolNames()).not.toContain("searchJobs");
    expect(toolNames()).not.toContain("startResumeReview");
    expect(supabase.callsFor("user_info")).toHaveLength(0);
  });

  it("loads only company sessions, and 404s a session of the other role", async () => {
    supabase.queue("agent_sessions", { data: { ...SESSION, role: "applicant" }, error: null });

    const res = await submit(text("u1", "user", "hi"));

    expect(res.status).toBe(404);
    expect(supabase.callsFor("agent_sessions")[0].chain).toContainEqual({
      method: "eq",
      args: ["role", "company"],
    });
    expect(model.doStreamCalls).toHaveLength(0);
  });

  it(`caps recruiters at ${RA_DAILY_MESSAGE_CAP} messages a day`, async () => {
    queueTurn({ todayCount: RA_DAILY_MESSAGE_CAP });

    const res = await submit(text("u1", "user", "hi"));

    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({
      error: `You've reached today's limit of ${RA_DAILY_MESSAGE_CAP} messages. Try again tomorrow.`,
    });
    expect(consumeEntitlement).not.toHaveBeenCalled();
  });

  it("charges one agent message per user message, before the model runs (BLT-105)", async () => {
    queueTurn({ todayCount: 25 });

    const res = await submit(text("u1", "user", "hi"));
    await res.text();

    expect(consumeEntitlement).toHaveBeenCalledWith(
      COMPANY_A.id,
      "agent_messages",
      1,
      { type: "agent_message", id: "u1" },
      USER_ID,
    );
    expect(vi.mocked(consumeEntitlement).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(google).mock.invocationCallOrder[0],
    );
  });

  it("returns 402 without saving or calling the model when the allowance is used up", async () => {
    queueTurn();
    vi.mocked(consumeEntitlement).mockRejectedValue(
      new EntitlementError({
        key: "agent_messages",
        kind: "allowance",
        qty: 1,
        used: 100,
        amount: 100,
        overageCredits: null,
        creditBalance: 0,
        creditsNeeded: 0,
        reason: "limit_reached",
        suggestedTier: { slug: "startup", name: "Startup" },
      }),
    );

    const res = await submit(text("u1", "user", "hi"));

    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ code: "entitlement", key: "agent_messages" });
    expect(model.doStreamCalls).toHaveLength(0);
    expect(
      supabase.callsFor("agent_messages").filter((c) => c.chain[0].method === "upsert"),
    ).toHaveLength(0);
  });

  it("charges a regenerate with the parent message's id, so it's free", async () => {
    const history = [text("u1", "user", "hi"), text("a1", "assistant", "old answer")];
    queueTurn({ history });
    supabase.queue("agent_messages", { data: { seq: 1 }, error: null });

    const res = await chat({ sessionId: SESSION_ID, trigger: "regenerate-message", messageId: "a1" });
    await res.text();

    expect(consumeEntitlement).toHaveBeenCalledWith(
      COMPANY_A.id,
      "agent_messages",
      1,
      { type: "agent_message", id: "u1" },
      USER_ID,
    );
  });

  it("doesn't charge a continuation after an approval", async () => {
    const pending = {
      id: "a1",
      role: "assistant",
      parts: [
        {
          type: "tool-createJobPost",
          toolCallId: "c1",
          state: "approval-requested",
          input: { title: "x" },
          approval: { id: "ap1" },
        },
      ],
    } as UIMessage;
    queueTurn({ history: [text("u1", "user", "write a job post"), pending], countCheck: false });
    const denied = {
      ...pending,
      parts: [{ ...pending.parts[0], state: "approval-responded", approval: { id: "ap1", approved: false } }],
    };

    const res = await submit(denied as UIMessage);
    await res.text();

    expect(res.status).toBe(200);
    expect(consumeEntitlement).not.toHaveBeenCalled();
  });

  it("traces with the recruiter prefix and company, and logs the role and company", async () => {
    queueTurn();

    const res = await submit(text("u1", "user", "hi"));
    await res.text();
    await flushAfter();

    const context = { sessionId: SESSION_ID, userId: USER_ID, companyId: COMPANY_A.id };
    expect(agentTelemetry).toHaveBeenCalledWith("recruiter-agent-chat", context);
    expect(agentTelemetry).toHaveBeenCalledWith("recruiter-agent-suggestions", context);
    expect(generateFollowUps).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ role: "company" }));
    expect(eventCaptureServer).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "agent_chat_turn",
        properties: expect.objectContaining({ role: "company", company_id: COMPANY_A.id }),
      }),
    );
  });
});
