import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";
import { GET as GET_ONE } from "./[session_id]/route";
import { buildRequest } from "@/test/utils/request";
import { setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A } from "@/test/utils/recruiter";
import { MEMBER_A, OWNER_A } from "@/test/utils/team";

vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/helpers/posthog/EventCaptureServerException", () => ({
  eventCaptureServerException: vi.fn(),
}));

const SESSION_ID = "55555555-5555-4555-8555-555555555555";

let supabase: SupabaseMock;

beforeEach(async () => {
  supabase = createSupabaseMock();
  supabase.queueRpc("my_company_access", { data: OWNER_A.membership, error: null });
  await setRequestUser(COMPANY_A.user, supabase.client);
});

describe("sessions routes for a company user (RAT-012)", () => {
  it("lists only company sessions", async () => {
    supabase.queue("agent_sessions", { data: [], error: null });

    expect((await GET()).status).toBe(200);
    expect(supabase.callsFor("agent_sessions")[0].chain).toContainEqual({
      method: "eq",
      args: ["role", "company"],
    });
  });

  it("creates sessions with the company role", async () => {
    supabase.queue("agent_sessions", {
      data: { id: SESSION_ID, title: "New chat", updated_at: "u" },
      error: null,
    });

    const res = await POST(buildRequest("/api/agent/sessions", { method: "POST", body: {} }));

    expect(res.status).toBe(201);
    expect(supabase.callsFor("agent_sessions")[0].chain[0]).toEqual({
      method: "insert",
      args: [{ user_id: COMPANY_A.user.id, role: "company" }],
    });
  });

  it("returns 404 for an applicant session", async () => {
    supabase.queue("agent_sessions", {
      data: { id: SESSION_ID, user_id: COMPANY_A.user.id, role: "applicant" },
      error: null,
    });

    const res = await GET_ONE(buildRequest("/x"), {
      params: Promise.resolve({ session_id: SESSION_ID }),
    });

    expect(res.status).toBe(404);
  });

  it("keeps a member's chats to themselves: filtered by user, never by company (TM-REQ-007)", async () => {
    supabase = createSupabaseMock();
    supabase.queueRpc("my_company_access", { data: MEMBER_A.membership, error: null });
    supabase.queue("agent_sessions", { data: [], error: null });
    await setRequestUser(MEMBER_A.user, supabase.client);

    expect((await GET()).status).toBe(200);
    const filters = supabase.callsFor("agent_sessions")[0].chain.filter((m) => m.method === "eq");
    expect(filters).toContainEqual({ method: "eq", args: ["user_id", MEMBER_A.user.id] });
    expect(filters.map((m) => m.args[0])).not.toContain("company_id");
  });
});
