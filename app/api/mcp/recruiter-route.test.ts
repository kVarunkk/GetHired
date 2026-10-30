/**
 * RMT-033: /api/mcp for company users (RMCP spec §4.8). Who gets which tools
 * (RMCP-REQ-008), the role's filter and run-time check (RMCP-REQ-004), job
 * scope, stateless role changes (RMCP-SEC-002), round trips through the
 * recruiter agent's tools, and both confirm paths (RMT-046). The applicant cases
 * stay in route.test.ts and applicant-baseline.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { mockUser } from "@/test/utils/auth";
import { legacyRequest, modernRequest, rpc } from "@/test/utils/mcp";
import {
  ADMIN_A,
  HIRING_MANAGER_A,
  JOB_A1,
  JOB_A2,
  MEMBER_A,
  OWNER_A,
  memberWith,
  type MemberFixture,
} from "@/test/utils/team";
import { COMPANY_A } from "@/test/utils/recruiter";
import { CANDIDATE_PROFILE, INJECTION_LINE } from "@/test/utils/matching";
import { createMcpSupabaseClient, verifyMcpToken } from "@/helpers/mcp/auth";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { consumeEntitlement, getEntitlements, holdEntitlement } from "@/helpers/billing/entitlements";
import { EntitlementError } from "@/helpers/billing/errors";
import { explainCandidateMatch } from "@/helpers/matching/explain-candidate-match";
import { createStage } from "@/helpers/pipeline/stages";
import { moveApplications, previewMove } from "@/helpers/pipeline/move";
import { queueJobScreenings } from "@/helpers/matching/queue-screenings";
import { queueJobPostingRelevance } from "@/helpers/profiles/queue-job-relevance";
import { inviteApplicants } from "@/helpers/interview/screening/invite";
import { setJobPostStatus } from "@/helpers/jobs/set-job-post-status";
import { upsertJobPosting } from "@/helpers/jobs/upsert-job-posting";
import { loadRecruiterJobSummaries } from "@/helpers/agent/roles/recruiter/context";
import { eventCaptureServerException } from "@/helpers/posthog/EventCaptureServerException";
import { forbiddenMessage } from "@/helpers/companies/permissions";
import { mcpCompanyRefusalCopy, mcpNoAccountTypeCopy } from "@/helpers/mcp/copy";
import { RECRUITER_MCP_TOOLS } from "@/helpers/mcp/recruiter-tools";
import { MCP_TOOLS } from "@/helpers/mcp/tools";
import { POST } from "./route";

vi.mock("@/helpers/mcp/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/helpers/mcp/auth")>()),
  verifyMcpToken: vi.fn(),
  createMcpSupabaseClient: vi.fn(),
}));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/helpers/billing/entitlements", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/helpers/billing/entitlements")>()),
  getEntitlements: vi.fn(),
  consumeEntitlement: vi.fn(),
  holdEntitlement: vi.fn(),
}));
vi.mock("@/helpers/matching/explain-candidate-match", () => ({ explainCandidateMatch: vi.fn() }));
vi.mock("@/helpers/pipeline/stages", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/helpers/pipeline/stages")>()),
  createStage: vi.fn(),
}));
vi.mock("@/helpers/matching/queue-screenings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/helpers/matching/queue-screenings")>()),
  queueJobScreenings: vi.fn(),
}));
vi.mock("@/helpers/profiles/queue-job-relevance", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/helpers/profiles/queue-job-relevance")>()),
  queueJobPostingRelevance: vi.fn(),
}));
vi.mock("@/helpers/interview/screening/invite", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/helpers/interview/screening/invite")>()),
  inviteApplicants: vi.fn(),
}));
vi.mock("@/helpers/jobs/set-job-post-status", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/helpers/jobs/set-job-post-status")>()),
  setJobPostStatus: vi.fn(),
}));
vi.mock("@/helpers/jobs/upsert-job-posting", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/helpers/jobs/upsert-job-posting")>()),
  upsertJobPosting: vi.fn(),
}));
vi.mock("@/helpers/pipeline/move", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/helpers/pipeline/move")>()),
  previewMove: vi.fn(),
  moveApplications: vi.fn(),
}));
vi.mock("@/helpers/agent/roles/recruiter/context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/helpers/agent/roles/recruiter/context")>()),
  loadRecruiterJobSummaries: vi.fn(),
}));
vi.mock("@/helpers/posthog/EventCaptureServer", () => ({ eventCaptureServer: vi.fn() }));
vi.mock("@/helpers/posthog/EventCaptureServerException", () => ({
  eventCaptureServerException: vi.fn(),
}));

const TOKEN = "oauth-access-token";
const HEADERS = { host: "localhost:3000", authorization: `Bearer ${TOKEN}` };
const CANDIDATE = CANDIDATE_PROFILE.user_id;
const APP_ID = "e0000000-0000-4000-8000-000000000001";

let supabase: SupabaseMock;

function signIn(user = OWNER_A.user) {
  supabase.setUser(user);
  vi.mocked(verifyMcpToken).mockResolvedValue({
    ok: true,
    token: TOKEN,
    claims: { sub: user.id, client_id: "client-1", exp: 2_000_000_000, scope: "openid email" },
  });
}

/** Signs in as `member`: my_company_access answers with their access on each of the next few requests. */
function signInAs(member: MemberFixture, requests = 3) {
  signIn(member.user);
  for (let i = 0; i < requests; i++) supabase.queueRpc("my_company_access", { data: member.membership, error: null });
}

const list = async () => {
  const { body } = await rpc(await POST(modernRequest("tools/list", {}, { headers: HEADERS })));
  return body.result as { tools: { name: string; annotations: Record<string, unknown> }[]; ttlMs?: number };
};
const names = async () => (await list()).tools.map((tool) => tool.name).sort();
const call = async (name: string, args: Record<string, unknown> = {}) =>
  (await rpc(await POST(modernRequest("tools/call", { name, arguments: args }, { headers: HEADERS })))).body;
/** The server instructions, from a (2025-era, stateless) initialize. */
const instructions = async () => {
  const { body } = await rpc(
    await POST(
      legacyRequest(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } },
        },
        { headers: HEADERS },
      ),
    ),
  );
  return body.result.instructions as string;
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("MCP_STATE_SECRET", "test-secret-that-is-at-least-32-bytes-long");
  supabase = createSupabaseMock();
  vi.mocked(createMcpSupabaseClient).mockReturnValue(supabase.client);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("who gets which tools (RMCP-REQ-008)", () => {
  it("an applicant still gets the applicant catalog", async () => {
    signIn(mockUser({ id: "00000000-0000-4000-8000-000000000001", type: "applicant" }));

    expect(await names()).toEqual(MCP_TOOLS.map((tool) => tool.name).sort());
    expect(supabase.callsFor("my_company_access")).toHaveLength(0);
  });

  it("an owner gets every recruiter tool, and none of the applicant ones", async () => {
    signInAs(OWNER_A);

    expect(await names()).toEqual(RECRUITER_MCP_TOOLS.map((tool) => tool.name).sort());
  });

  it("an Admin gets the recruiter catalog", async () => {
    signInAs(ADMIN_A);

    const listed = await names();
    expect(listed).toEqual(expect.arrayContaining(["get_my_company", "list_applicants", "create_job_post"]));
  });

  it("a Member without mcp.use gets nothing, and a call says which permission is missing", async () => {
    signInAs(MEMBER_A);

    expect(await names()).toEqual([]);
    const body = await call("list_applicants");
    expect(body.result).toMatchObject({ isError: true, content: [{ text: mcpCompanyRefusalCopy("forbidden") }] });
    expect(mcpCompanyRefusalCopy("forbidden")).toContain(forbiddenMessage("mcp.use"));
  });

  it("a company user who hasn't onboarded gets nothing, and a call points to get-started", async () => {
    signIn(mockUser({ id: OWNER_A.user.id, type: "company", onboardingComplete: false }));

    expect(await names()).toEqual([]);
    const body = await call("get_my_company");
    expect(body.result).toMatchObject({ isError: true, content: [{ text: mcpCompanyRefusalCopy("not_onboarded") }] });
    expect(mcpCompanyRefusalCopy("not_onboarded")).toContain("http://localhost:3000/get-started?company=true");
  });

  it("a company user with no company gets nothing", async () => {
    signIn(OWNER_A.user);
    supabase.queueRpc("my_company_access", { data: null, error: null });

    expect(await names()).toEqual([]);
  });

  it("an account with no type gets nothing, and a call points to the web app", async () => {
    signIn(mockUser({ id: OWNER_A.user.id }));
    supabase.setUser({ ...OWNER_A.user, app_metadata: {} });

    expect(await names()).toEqual([]);
    expect((await call("get_my_company")).result).toMatchObject({
      isError: true,
      content: [{ text: mcpNoAccountTypeCopy() }],
    });
  });

  it("gives company callers their own instructions, and refused callers the reason", async () => {
    signInAs(OWNER_A, 1);
    expect(await instructions()).toMatch(/hiring team.*Tools follow your role's permissions\. Links in results open http:\/\/localhost:3000/);

    signInAs(MEMBER_A);
    expect(await instructions()).toBe(mcpCompanyRefusalCopy("forbidden"));
  });
});

describe("the role's tool set (RMCP-REQ-004, RP-REQ-030/031)", () => {
  it("leaves out update_job_post for a role without jobs.edit, and refuses a call to it", async () => {
    signInAs(memberWith(["mcp.use", "jobs.view"]));

    const listed = await names();
    expect(listed).toContain("list_my_jobs");
    expect(listed).not.toContain("update_job_post");
    expect((await call("update_job_post", { jobPostId: JOB_A1, title: "x" })).error).toMatchObject({
      message: expect.stringMatching(/update_job_post not found/),
    });
  });

  it("refuses list_applicants for a job the member isn't assigned to", async () => {
    signInAs({
      ...HIRING_MANAGER_A,
      membership: {
        ...HIRING_MANAGER_A.membership,
        grants: [...HIRING_MANAGER_A.membership.grants, { key: "mcp.use", scope: "all" }],
      },
    } as MemberFixture);

    expect(await names()).toContain("list_applicants");
    const body = await call("list_applicants", { jobPostId: JOB_A2 });

    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).not.toBe(mcpCompanyRefusalCopy("forbidden"));
    expect(body.result.content[0].text).toMatch(/assigned|Your role can't view applicants/);
    expect(supabase.callsFor("applications")).toHaveLength(0);
  });

  it("picks up a role change on the next request (stateless, RMCP-SEC-002)", async () => {
    signIn(ADMIN_A.user);
    supabase.queueRpc("my_company_access", { data: ADMIN_A.membership, error: null });
    supabase.queueRpc("my_company_access", { data: MEMBER_A.membership, error: null });

    expect(await names()).toContain("list_applicants");
    expect((await call("list_applicants")).result.content[0].text).toBe(mcpCompanyRefusalCopy("forbidden"));
    expect(supabase.callsFor("my_company_access")).toHaveLength(2);
  });
});

describe("tools/call round trips", () => {
  beforeEach(() => signInAs(OWNER_A));

  it("get_my_company runs on the session company and a user-scoped client, never the service role", async () => {
    vi.mocked(getEntitlements).mockResolvedValue({
      tier: { name: "Pro" },
      creditBalance: 12,
      period: { end: "2026-11-30" },
      entitlements: {},
    } as never);

    const body = await call("get_my_company");

    expect(getEntitlements).toHaveBeenCalledWith(COMPANY_A.id);
    expect(createMcpSupabaseClient).toHaveBeenCalledWith(TOKEN);
    expect(createServiceRoleClient).not.toHaveBeenCalled();
    expect(body.result.structuredContent).toMatchObject({ plan: "Pro", creditBalance: 12 });
    expect(body.result.structuredContent.billingUrl).toMatch(/^http:\/\/localhost:3000\//);
  });

  it("list_my_jobs lists the company's jobs with absolute links", async () => {
    vi.mocked(loadRecruiterJobSummaries).mockResolvedValue([
      { id: JOB_A1, title: "Frontend Engineer", status: "active", matching_status: "done", applicants: 3, new_24h: 1 },
    ] as never);

    const body = await call("list_my_jobs");

    expect(loadRecruiterJobSummaries).toHaveBeenCalledWith(supabase.client, COMPANY_A.id, expect.anything());
    expect(body.result.structuredContent.jobs[0]).toMatchObject({
      id: JOB_A1,
      url: `http://localhost:3000/company/job-posts/${JOB_A1}`,
    });
  });

  it("list_applicants sandboxes names and returns no contact details", async () => {
    supabase.queue("applications", {
      data: [
        {
          id: APP_ID,
          status: "submitted",
          created_at: "2026-10-20T00:00:00Z",
          applicant_user_id: null,
          company_candidate_id: "c0000000-0000-4000-8000-000000000001",
          job_postings: { id: JOB_A1, title: "Frontend Engineer", company_id: COMPANY_A.id },
          pipeline_stages: null,
          user_info: null,
          company_candidates: { full_name: `Meera ${INJECTION_LINE}` },
          application_screenings: null,
        },
      ],
      error: null,
    });

    const body = await call("list_applicants", { jobPostId: JOB_A1 });

    const text = body.result.content[0].text as string;
    expect(body.result.structuredContent.applicants[0].name).toMatch(/^<candidate_name>/);
    expect(text).not.toMatch(/@|phone|linkedin/i);
    const columns = String(
      supabase.callsFor("applications")[0].chain.find((step) => step.method === "select")!.args[0],
    );
    expect(columns).not.toMatch(/email|phone/);
  });

  it("create_stage runs without confirming", async () => {
    vi.mocked(createStage).mockResolvedValue({
      ok: true,
      stage: { id: "90000000-0000-4000-8000-000000000009", name: "Take-home", kind: "interview" },
    } as never);

    const body = await call("create_stage", { name: "Take-home", kind: "interview" });

    expect(createStage).toHaveBeenCalledWith(
      expect.objectContaining({ company: expect.objectContaining({ id: COMPANY_A.id }), surface: "mcp" }),
      { name: "Take-home", kind: "interview" },
    );
    expect(body.result.structuredContent.stage).toMatchObject({ name: "Take-home" });
  });

  it("save_candidate saves for the session company", async () => {
    supabase.queueRpc("company_can_view_candidate", { data: true, error: null });
    supabase.queue("company_favorites", { data: [], error: null });
    supabase.queue("company_favorites", { data: null, error: null });

    const body = await call("save_candidate", { candidateId: CANDIDATE });

    expect(body.result.structuredContent).toEqual({ candidateId: CANDIDATE, saved: true });
    const insert = supabase
      .callsFor("company_favorites")
      .flatMap((c) => c.chain)
      .find((step) => step.method === "insert");
    expect(insert?.args[0]).toEqual({ company_id: COMPANY_A.id, user_id: CANDIDATE });
  });

  it("answers a confirm tool with its preview and a token, and runs nothing yet", async () => {
    supabase.queue("job_postings", { data: { id: JOB_A1, title: "Frontend Engineer", status: "active" }, error: null });

    const body = await call("delete_job_post", { jobPostId: JOB_A1 });

    expect(body.result.structuredContent).toMatchObject({
      needsConfirmation: true,
      preview: expect.stringMatching(/Delete this job post\?[\s\S]*Job: Frontend Engineer/),
      confirmation_token: expect.any(String),
    });
    const writes = supabase
      .callsFor("job_postings")
      .flatMap((c) => c.chain)
      .filter((step) => step.method === "delete" || step.method === "update");
    expect(writes).toEqual([]);
  });

  it("tags unexpected tool errors with flow: mcp_tool", async () => {
    supabase.queue("applications", { data: null, error: { message: "relation does not exist" } });

    const body = await call("list_applicants", {});

    expect(body.result.isError).toBe(true);
    expect(eventCaptureServerException).toHaveBeenCalledWith(
      expect.objectContaining({ properties: expect.objectContaining({ flow: "mcp_tool", tool: "listApplicants" }) }),
    );
  });
});

describe("toolsets on the URL (RMT-051, RMCP spec §4.5)", () => {
  const at = (query: string) => `http://localhost:3000/api/mcp${query}`;
  const listAt = async (query: string) => {
    const res = await POST(modernRequest("tools/list", {}, { headers: HEADERS, url: at(query) }));
    return rpc(res);
  };
  const namesAt = async (query: string) =>
    ((await listAt(query)).body.result.tools as { name: string }[]).map((tool) => tool.name).sort();
  const rowsIn = (...toolsets: string[]) =>
    RECRUITER_MCP_TOOLS.filter((tool) => toolsets.includes(tool.toolset)).map((tool) => tool.name).sort();

  it("lists only the named toolsets, plus core", async () => {
    signInAs(OWNER_A);

    expect(await namesAt("?toolsets=jobs,pipeline")).toEqual(rowsIn("core", "jobs", "pipeline"));
  });

  it("readonly=true lists only read-only tools, credit-spending reads included", async () => {
    signInAs(OWNER_A);

    const { body } = await listAt("?readonly=true");
    const tools = body.result.tools as { name: string; annotations: { readOnlyHint: boolean } }[];
    expect(tools.length).toBeGreaterThan(0);
    expect(tools.every((tool) => tool.annotations.readOnlyHint)).toBe(true);
    expect(tools.map((tool) => tool.name)).toContain("explain_match");
    expect(tools.map((tool) => tool.name)).not.toContain("create_stage");
  });

  it("refuses a call to a tool its toolsets leave out, as an unknown tool", async () => {
    signInAs(OWNER_A);

    const res = await POST(
      modernRequest("tools/call", { name: "create_stage", arguments: {} }, { headers: HEADERS, url: at("?toolsets=jobs") }),
    );
    expect((await rpc(res)).body.error).toMatchObject({ message: expect.stringMatching(/create_stage not found/) });
    expect(createStage).not.toHaveBeenCalled();
  });

  it("says which toolsets are connected when the list is filtered", async () => {
    const initializeAt = async (query: string) =>
      (
        await rpc(
          await POST(
            legacyRequest(
              {
                jsonrpc: "2.0",
                id: 1,
                method: "initialize",
                params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } },
              },
              { headers: HEADERS, url: at(query) },
            ),
          ),
        )
      ).body.result.instructions as string;

    signInAs(OWNER_A, 1);
    expect(await initializeAt("?toolsets=pipeline,jobs&readonly=true")).toMatch(
      /Only these toolsets are connected: jobs, pipeline\. This connection is read-only\.$/,
    );
    signInAs(OWNER_A, 1);
    expect(await initializeAt("")).not.toMatch(/toolsets|read-only/);
  });

  it("answers 400 with the valid names for a company caller with an unknown toolset", async () => {
    signInAs(OWNER_A);

    const { status, body } = await listAt("?toolsets=jobs,payments");
    expect(status).toBe(400);
    expect(body.error.message).toMatch(/Unknown GetHired toolset in the server URL: payments\. Valid toolsets: all, core, jobs/);
    expect(body.error.data).toEqual({ invalid: ["payments"], valid: expect.arrayContaining(["all", "core", "careers"]) });
  });

  it("ignores both parameters for an applicant, even an unknown toolset", async () => {
    signIn(mockUser({ id: "00000000-0000-4000-8000-000000000001", type: "applicant" }));

    const { status } = await listAt("?toolsets=payments&readonly=true");
    expect(status).toBe(200);
    expect(await namesAt("?toolsets=jobs&readonly=true")).toEqual(MCP_TOOLS.map((tool) => tool.name).sort());
  });

  it("still points a 401 to the path's metadata on a URL with a query", async () => {
    vi.mocked(verifyMcpToken).mockImplementation(async () => {
      const { unauthorized } = await vi.importActual<typeof import("@/helpers/mcp/auth")>("@/helpers/mcp/auth");
      return { ok: false, response: unauthorized() };
    });

    const res = await POST(modernRequest("tools/list", {}, { headers: HEADERS, url: at("?toolsets=jobs&readonly=true") }));
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toMatch(
      /resource_metadata="http:\/\/localhost:3000\/\.well-known\/oauth-protected-resource\/api\/mcp"$/,
    );
  });
});

describe("credits and allowances (RMT-036, RMCP-REQ-006)", () => {
  const ROW_ID = "d0000000-0000-4000-8000-000000000001";
  const PAYLOAD = {
    key: "resume_imports" as const,
    kind: "allowance" as const,
    qty: 1,
    used: 50,
    amount: 50,
    overageCredits: null,
    creditBalance: 0,
    creditsNeeded: 1,
    reason: "limit_reached" as const,
    suggestedTier: null,
  };

  beforeEach(() => signInAs(OWNER_A));

  const failedRow = () =>
    supabase.queue("candidate_import_rows", {
      data: { id: ROW_ID, status: "failed", candidate_import_batches: { expires_at: null } },
      error: null,
    });

  it("explain_match runs the shared helper once, as the session user and company", async () => {
    vi.mocked(explainCandidateMatch).mockResolvedValue({
      ok: true,
      explanation: { summary: "Strong fit." },
      cached: false,
    } as never);

    const body = await call("explain_match", { candidateId: CANDIDATE, jobPostId: JOB_A1 });

    expect(body.result.isError).toBeFalsy();
    expect(explainCandidateMatch).toHaveBeenCalledTimes(1);
    expect(explainCandidateMatch).toHaveBeenCalledWith(
      expect.objectContaining({
        user: expect.objectContaining({ id: OWNER_A.user.id }),
        company: expect.objectContaining({ id: COMPANY_A.id }),
        surface: "mcp",
      }),
      { candidateId: CANDIDATE, jobPostId: JOB_A1 },
      // Traced as mcp.explain_match (RMT-053); off here, since Arize isn't configured.
      expect.objectContaining({ telemetry: { isEnabled: false } }),
    );
  });

  it("retry_import_rows holds one resume import per row, with the session user as the actor", async () => {
    failedRow();
    supabase.queueRpc("retry_import_row", { data: { ok: true }, error: null });

    const body = await call("retry_import_rows", { rowIds: [ROW_ID] });

    expect(body.result.structuredContent).toEqual({ rows: [{ rowId: ROW_ID, queued: true }] });
    expect(holdEntitlement).toHaveBeenCalledTimes(1);
    expect(holdEntitlement).toHaveBeenCalledWith(
      COMPANY_A.id,
      "resume_imports",
      1,
      expect.anything(),
      OWNER_A.user.id,
      expect.anything(),
    );
  });

  it("turns a used-up allowance into a tool error with the full upgrade link", async () => {
    failedRow();
    vi.mocked(holdEntitlement).mockRejectedValueOnce(new EntitlementError(PAYLOAD));

    const body = await call("retry_import_rows", { rowIds: [ROW_ID] });

    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toContain(new EntitlementError(PAYLOAD).message);
    expect(body.result.content[0].text).toContain("The user can upgrade at http://localhost:3000/company/billing.");
    expect(supabase.callsFor("retry_import_row")).toHaveLength(0);
  });

  it("charges no agent message for any MCP call", async () => {
    vi.mocked(getEntitlements).mockResolvedValue({
      tier: { name: "Pro" },
      creditBalance: 0,
      period: { end: "2026-11-30" },
      entitlements: {},
    } as never);
    vi.mocked(explainCandidateMatch).mockResolvedValue({ ok: true, explanation: {}, cached: true } as never);

    await call("get_my_company");
    await call("explain_match", { candidateId: CANDIDATE, jobPostId: JOB_A1 });

    const keys = [...vi.mocked(consumeEntitlement).mock.calls, ...vi.mocked(holdEntitlement).mock.calls].map(
      (args) => args[1],
    );
    expect(keys).not.toContain("agent_messages");
  });
});

describe("confirm tools (RMT-046, RMCP-REQ-005)", () => {
  const ELICIT = { elicitation: { form: {} } };
  const ACCEPT = { confirm: { action: "accept", content: { confirm: true } } };
  const STAGE_ID = "90000000-0000-4000-8000-000000000002";
  const NOTE_ID = "a1000000-0000-4000-8000-000000000001";
  const MOVE = { applicationIds: [APP_ID], stageId: STAGE_ID };
  const STAGE = { id: STAGE_ID, name: "Interview", kind: "interview" as const };

  const callWith = async (
    name: string,
    args: Record<string, unknown>,
    { capabilities = {}, extra = {} }: { capabilities?: Record<string, unknown>; extra?: Record<string, unknown> } = {},
  ) =>
    (
      await rpc(
        await POST(modernRequest("tools/call", { name, arguments: args, ...extra }, { headers: HEADERS, capabilities })),
      )
    ).body;

  /** What a move's preview reads: each application's job, then the helper. */
  const movePreview = () => {
    supabase.queueRpc("application_job_id", { data: JOB_A1, error: null });
    vi.mocked(previewMove).mockResolvedValueOnce({
      ok: true,
      stage: STAGE,
      applications: [{ id: APP_ID, name: "Meera", jobTitle: "Frontend Engineer", moves: true, emailed: false }],
      notFound: 0,
      email: null,
    });
  };
  /** What the confirmed run reads: the run-time permission check, then the move. */
  const moveRun = () => {
    supabase.queueRpc("application_job_id", { data: JOB_A1, error: null });
    vi.mocked(moveApplications).mockResolvedValueOnce({
      ok: true,
      moved: 1,
      emailed: 0,
      skipped: [],
      stage: STAGE,
      applications: [],
      movedIds: [APP_ID],
    } as never);
  };
  const alreadyUsed = () =>
    supabase.queue("mcp_confirmations", { data: null, error: { code: "23505", message: "duplicate key" } });
  /** What the claim of a path B token answers: "claimed", or why not. */
  const tokenClaim = (reason: string) =>
    supabase.queueRpc("claim_mcp_confirmation", { data: reason, error: null });
  const outcomes = () =>
    supabase
      .callsFor("mcp_tool_calls")
      .flatMap((c) => c.chain.filter((step) => step.method === "insert"))
      .map((step) => (step.args[0] as { outcome: string }).outcome);

  it("path A: move_applications asks through elicitation, runs once on yes, and not again on a replay", async () => {
    signInAs(OWNER_A, 3);
    movePreview();

    const first = await callWith("move_applications", MOVE, { capabilities: ELICIT });

    expect(first.result).toMatchObject({
      resultType: "input_required",
      inputRequests: {
        confirm: { params: { message: expect.stringMatching(/Move 1 application to Interview\?[\s\S]*Stage: Interview/) } },
      },
    });
    expect(moveApplications).not.toHaveBeenCalled();

    moveRun();
    const extra = { inputResponses: ACCEPT, requestState: first.result.requestState };
    const yes = await callWith("move_applications", MOVE, { capabilities: ELICIT, extra });

    expect(yes.result.structuredContent).toMatchObject({ moved: 1, stage: { name: "Interview" } });
    expect(moveApplications).toHaveBeenCalledOnce();
    expect(moveApplications).toHaveBeenCalledWith(
      expect.objectContaining({ company: expect.objectContaining({ id: COMPANY_A.id }), surface: "mcp" }),
      { applicationIds: [APP_ID], stageId: STAGE_ID, email: undefined },
    );

    alreadyUsed();
    const replay = await callWith("move_applications", MOVE, { capabilities: ELICIT, extra });

    expect(replay.result.content[0].text).toMatch(/already confirmed and done/);
    expect(moveApplications).toHaveBeenCalledOnce();
    expect(outcomes()).toEqual(["needs_confirmation", "ok", "denied"]);
  });

  it("logs each step with the session company and the email flag (RMT-052)", async () => {
    signInAs(OWNER_A, 3);
    movePreview();
    const first = await callWith("move_applications", MOVE, { capabilities: ELICIT });
    moveRun();
    await callWith("move_applications", MOVE, {
      capabilities: ELICIT,
      extra: { inputResponses: ACCEPT, requestState: first.result.requestState },
    });
    await callWith("get_my_company", {});

    const rows = supabase
      .callsFor("mcp_tool_calls")
      .flatMap((c) => c.chain.filter((step) => step.method === "insert"))
      .map((step) => step.args[0] as Record<string, unknown>);
    expect(rows).toEqual([
      expect.objectContaining({ tool: "move_applications", outcome: "needs_confirmation", email: true, company_id: COMPANY_A.id }),
      expect.objectContaining({ tool: "move_applications", outcome: "ok", email: true, company_id: COMPANY_A.id }),
      expect.objectContaining({ tool: "get_my_company", company_id: COMPANY_A.id }),
    ]);
    expect(rows[2]).not.toHaveProperty("email");
    // The email limit is checked on both move steps; only rows that ran count (limits.test.ts).
    const emailWindows = supabase
      .callsFor("mcp_tool_calls")
      .filter((c) => c.chain.some((step) => step.method === "eq" && step.args[0] === "email"));
    expect(emailWindows).toHaveLength(2);
  });

  it("path A: a decline doesn't move anything", async () => {
    signInAs(OWNER_A, 2);
    movePreview();
    const first = await callWith("move_applications", MOVE, { capabilities: ELICIT });

    const no = await callWith("move_applications", MOVE, {
      capabilities: ELICIT,
      extra: { inputResponses: { confirm: { action: "decline" } }, requestState: first.result.requestState },
    });

    expect(no.result.content[0].text).toMatch(/declined/);
    expect(moveApplications).not.toHaveBeenCalled();
  });

  it("path B: move_applications runs once with its token; a changed input, a reused token and another user's token are refused", async () => {
    signInAs(OWNER_A, 4);
    movePreview();
    const first = await callWith("move_applications", MOVE);
    const token = first.result.structuredContent.confirmation_token as string;
    expect(first.result.structuredContent.preview).toMatch(/Move 1 application to Interview\?/);

    // Another stage than the one previewed: a new preview, nothing moved.
    movePreview();
    tokenClaim("mismatch");
    const changed = await callWith("move_applications", {
      ...MOVE,
      stageId: "90000000-0000-4000-8000-000000000003",
      confirmation_token: token,
    });
    expect(changed.result.isError).toBe(true);
    expect(changed.result.structuredContent.refused).toMatch(/was for a different input/);
    expect(changed.result.structuredContent.confirmation_token).toEqual(expect.any(String));
    expect(moveApplications).not.toHaveBeenCalled();

    moveRun();
    tokenClaim("claimed");
    const confirmed = await callWith("move_applications", { ...MOVE, confirmation_token: token });
    expect(confirmed.result.structuredContent).toMatchObject({ moved: 1 });
    expect(moveApplications).toHaveBeenCalledOnce();

    tokenClaim("used");
    movePreview();
    const reused = await callWith("move_applications", { ...MOVE, confirmation_token: token });
    expect(reused.result.structuredContent.refused).toMatch(/already used/);
    expect(moveApplications).toHaveBeenCalledOnce();

    // The same token from someone else: the claim only finds the previewing user's.
    signInAs(ADMIN_A, 1);
    movePreview();
    tokenClaim("invalid");
    const foreign = await callWith("move_applications", { ...MOVE, confirmation_token: token });
    expect(foreign.result.structuredContent.refused).toMatch(/wasn't recognized/);
    expect(moveApplications).toHaveBeenCalledOnce();
  });

  it("update_note asks even though nothing was read first (the agent wouldn't)", async () => {
    signInAs(OWNER_A, 2);
    const note = {
      id: NOTE_ID,
      body: "Strong on systems.",
      rating: null,
      author_user_id: OWNER_A.user.id,
      application_id: null,
      candidate_user_id: CANDIDATE,
    };
    const args = { noteId: NOTE_ID, body: "Strong on systems and APIs." };
    supabase.queue("candidate_notes", { data: { application_id: null }, error: null });
    supabase.queue("candidate_notes", { data: note, error: null });
    supabase.queue("candidate_directory", { data: [{ user_id: CANDIDATE, full_name: "Meera" }], error: null });

    const first = await callWith("update_note", args);

    expect(first.result.structuredContent).toMatchObject({
      needsConfirmation: true,
      preview: expect.stringMatching(/Edit this note\?[\s\S]*Note after: <note>\nStrong on systems and APIs\./),
    });
    const updates = () =>
      supabase
        .callsFor("candidate_notes")
        .flatMap((c) => c.chain)
        .filter((step) => step.method === "update");
    expect(updates()).toEqual([]);

    supabase.queue("candidate_notes", { data: { application_id: null }, error: null });
    supabase.queue("candidate_notes", { data: [{ id: NOTE_ID }], error: null });
    tokenClaim("claimed");
    const confirmed = await callWith("update_note", {
      ...args,
      confirmation_token: first.result.structuredContent.confirmation_token,
    });

    expect(confirmed.result.structuredContent).toEqual({ noteId: NOTE_ID, updated: true });
    expect(updates().map((step) => step.args[0])).toEqual([{ body: "Strong on systems and APIs." }]);
  });

  /**
   * RMT-047 (RMCP-REQ-006): each spending confirm tool reaches the helper that
   * charges, holds or checks the plan only on the confirmed run, as the
   * session user, and not again on a replayed token.
   */
  const SPENDING: {
    tool: string;
    args: Record<string, unknown>;
    spend: () => ReturnType<typeof vi.fn>;
    preview: () => void;
    run: () => void;
  }[] = [
    {
      tool: "screen_applicants",
      args: { jobPostId: JOB_A1 },
      spend: () => vi.mocked(queueJobScreenings),
      preview: () => {
        supabase.queue("job_postings", { data: { id: JOB_A1, title: "Frontend Engineer" }, error: null });
        supabase.queue("applications", { data: [{ id: APP_ID }], error: null });
        supabase.queue("application_screenings", { data: [], error: null });
      },
      run: () => vi.mocked(queueJobScreenings).mockResolvedValueOnce({ ok: true, queued: 1 }),
    },
    {
      tool: "run_matching_for_job",
      args: { jobPostId: JOB_A1 },
      spend: () => vi.mocked(queueJobPostingRelevance),
      preview: () =>
        supabase.queue("job_postings", {
          data: { id: JOB_A1, title: "Frontend Engineer", matching_status: "completed" },
          error: null,
        }),
      run: () => vi.mocked(queueJobPostingRelevance).mockResolvedValueOnce({ success: true } as never),
    },
    {
      tool: "invite_to_interview",
      args: { applicationIds: [APP_ID] },
      spend: () => vi.mocked(inviteApplicants),
      preview: () => {
        supabase.queueRpc("application_job_id", { data: JOB_A1, error: null });
        supabase.queue("applications", {
          data: [{ id: APP_ID, job_post_id: JOB_A1, user_info: { full_name: "Meera" }, job_postings: { title: "Frontend Engineer" } }],
          error: null,
        });
        supabase.queue("job_interview_configs", {
          data: [{ job_post_id: JOB_A1, enabled: true, duration_minutes: 15 }],
          error: null,
        });
        supabase.queue("application_interviews", { data: [], error: null });
      },
      run: () => {
        supabase.queueRpc("application_job_id", { data: JOB_A1, error: null });
        supabase.queue("applications", { data: [{ id: APP_ID, job_post_id: JOB_A1 }], error: null });
        vi.mocked(inviteApplicants).mockResolvedValueOnce({
          ok: true,
          invited: [{ applicationId: APP_ID }],
          skipped: [],
        } as never);
      },
    },
    {
      tool: "set_job_post_status",
      args: { jobPostId: JOB_A1, status: "active" },
      spend: () => vi.mocked(setJobPostStatus),
      preview: () =>
        supabase.queue("job_postings", { data: { id: JOB_A1, title: "Frontend Engineer", status: "inactive" }, error: null }),
      run: () => vi.mocked(setJobPostStatus).mockResolvedValueOnce({ ok: true } as never),
    },
    {
      tool: "create_job_post",
      args: {
        title: "Backend Engineer",
        description: "Build APIs.",
        locations: ["Remote"],
        jobType: "Fulltime",
        salaryCurrency: "$",
        minSalary: 0,
        maxSalary: 0,
        minExperience: 2,
        visaSponsorship: "Not Required",
      },
      spend: () => vi.mocked(upsertJobPosting),
      preview: () => undefined,
      run: () =>
        vi.mocked(upsertJobPosting).mockResolvedValueOnce({ success: true, postingId: JOB_A2 } as never),
    },
  ];

  it.each(SPENDING)(
    "$tool spends only on the confirmed run, once (RMT-047)",
    async ({ tool, args, spend, preview, run }) => {
      signInAs(OWNER_A, 3);
      preview();

      const first = await callWith(tool, args);

      expect(first.result.structuredContent, JSON.stringify(first.result)).toMatchObject({ needsConfirmation: true });
      expect(spend()).not.toHaveBeenCalled();
      expect(consumeEntitlement).not.toHaveBeenCalled();
      expect(holdEntitlement).not.toHaveBeenCalled();

      run();
      tokenClaim("claimed");
      const token = first.result.structuredContent.confirmation_token;
      const confirmed = await callWith(tool, { ...args, confirmation_token: token });

      expect(confirmed.result.isError, JSON.stringify(confirmed.result)).toBeFalsy();
      expect(spend()).toHaveBeenCalledOnce();
      expect(spend().mock.calls[0][0]).toMatchObject({
        user: expect.objectContaining({ id: OWNER_A.user.id }),
        company: expect.objectContaining({ id: COMPANY_A.id }),
      });

      tokenClaim("used");
      preview();
      await callWith(tool, { ...args, confirmation_token: token });

      expect(spend()).toHaveBeenCalledOnce();
    },
  );

  it("create_job_post's confirmed run saves a draft, so it never publishes", async () => {
    signInAs(OWNER_A, 2);
    const args = SPENDING.find((s) => s.tool === "create_job_post")!.args;
    const first = await callWith("create_job_post", args);
    vi.mocked(upsertJobPosting).mockResolvedValueOnce({ success: true, postingId: JOB_A2 } as never);
    tokenClaim("claimed");

    const confirmed = await callWith("create_job_post", {
      ...args,
      confirmation_token: first.result.structuredContent.confirmation_token,
    });

    expect(confirmed.result.structuredContent).toMatchObject({ status: "inactive" });
    expect(vi.mocked(upsertJobPosting).mock.calls[0][1].values).not.toHaveProperty("status", "active");
  });

  it("refuses the confirmed run when the role changed after the preview", async () => {
    // Previewed as an Admin; by the confirmed call the role only moves applicants on another job.
    signInAs(ADMIN_A, 1);
    movePreview();
    const first = await callWith("move_applications", MOVE);
    const token = first.result.structuredContent.confirmation_token as string;

    signInAs(
      memberWith(["mcp.use", "applicants.view", { key: "pipeline.move", scope: "assigned" }], {
        assignedJobIds: [JOB_A2],
      }),
      1,
    );
    supabase.queueRpc("application_job_id", { data: JOB_A1, error: null });
    tokenClaim("claimed");
    const confirmed = await callWith("move_applications", { ...MOVE, confirmation_token: token });

    expect(confirmed.result.isError).toBe(true);
    expect(confirmed.result.content[0].text).toContain(forbiddenMessage("pipeline.move", { forJob: true }));
    expect(moveApplications).not.toHaveBeenCalled();
  });
});
