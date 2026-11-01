/**
 * RMT-000 / RMCP-CON-001: the applicant MCP as it was before the recruiter
 * catalog. The applicant snapshots must never change because of recruiter
 * work; only the company ones may, and only where a recruiter task says so.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { mockUser } from "@/test/utils/auth";
import { modernRequest, rpc } from "@/test/utils/mcp";
import { createMcpSupabaseClient, verifyMcpToken } from "@/helpers/mcp/auth";
import { MCP_TOOLS, mcpToolFlags } from "@/helpers/mcp/tools";
import { APPLICANT_APPROVAL_POLICY } from "@/helpers/agent/approval";
import { mcpCompanyRefusalCopy } from "@/helpers/mcp/copy";
import { POST } from "./route";

vi.mock("@/helpers/mcp/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/helpers/mcp/auth")>()),
  verifyMcpToken: vi.fn(),
  createMcpSupabaseClient: vi.fn(),
}));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/helpers/posthog/EventCaptureServer", () => ({ eventCaptureServer: vi.fn() }));
vi.mock("@/helpers/posthog/EventCaptureServerException", () => ({
  eventCaptureServerException: vi.fn(),
}));

const TOKEN = "oauth-access-token";
const USER_ID = "00000000-0000-4000-8000-000000000001";
const HEADERS = { host: "localhost:3000", authorization: `Bearer ${TOKEN}` };

let supabase: SupabaseMock;

function signIn(type: "applicant" | "company") {
  const user = mockUser({ id: USER_ID, type });
  supabase.setUser(user);
  vi.mocked(verifyMcpToken).mockResolvedValue({
    ok: true,
    token: TOKEN,
    claims: { sub: user.id, client_id: "client-1", exp: 2_000_000_000, scope: "openid email" },
  });
}

const list = async () =>
  (await rpc(await POST(modernRequest("tools/list", {}, { headers: HEADERS })))).body;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("MCP_STATE_SECRET", "test-secret-that-is-at-least-32-bytes-long");
  supabase = createSupabaseMock();
  vi.mocked(createMcpSupabaseClient).mockReturnValue(supabase.client);
});

describe("applicant MCP baseline", () => {
  it("tools/list for an applicant", async () => {
    signIn("applicant");

    expect((await list()).result.tools).toMatchSnapshot();
  });

  it("the confirm and credit flags of each applicant tool", () => {
    const flags = MCP_TOOLS.map((def) => [def.name, mcpToolFlags(def, APPLICANT_APPROVAL_POLICY)]);
    expect(Object.fromEntries(flags)).toMatchSnapshot();
  });
});

// RMT-033 replaced the company snapshots: a company token without a company
// still lists nothing, and tools/call now says why instead of "not found".
describe("company MCP without a company", () => {
  it("tools/list for a company token is empty", async () => {
    signIn("company");

    expect((await list()).result.tools).toEqual([]);
  });

  it("tools/call for a company token is a tool error with the get-started copy", async () => {
    signIn("company");

    const { body } = await rpc(
      await POST(modernRequest("tools/call", { name: "search_jobs", arguments: {} }, { headers: HEADERS })),
    );

    expect(body.result).toMatchObject({
      isError: true,
      content: [{ type: "text", text: mcpCompanyRefusalCopy("no_company") }],
    });
  });
});
