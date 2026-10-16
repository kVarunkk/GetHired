import { beforeEach, describe, expect, it, vi } from "vitest";
import { createOutreachTools } from "./outreach";
import { sendOutreach } from "@/helpers/outreach/send";
import { listCompanyOutreach, type CompanyOutreachItem } from "@/helpers/outreach/list";
import { execTool, inputJsonSchema, recruiterToolContext, validateInput } from "@/test/utils/tools";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A } from "@/test/utils/recruiter";
import { outreachOf } from "@/test/utils/outreach";

vi.mock("server-only", () => ({}));
vi.mock("@/helpers/posthog/EventCaptureServerException", () => ({
  eventCaptureServerException: vi.fn(),
}));
vi.mock("@/helpers/outreach/send", () => ({ sendOutreach: vi.fn() }));
vi.mock("@/helpers/outreach/list", () => ({ listCompanyOutreach: vi.fn() }));

const CANDIDATE = "a0000000-0000-4000-8000-000000000001";
const JOB = "b0000000-0000-4000-8000-000000000001";

const INPUT = {
  candidateId: CANDIDATE,
  jobPostId: JOB,
  subject: "Backend role at Acme",
  message: "Hi Ada, your Go work stood out. Open to a chat about our backend role?",
};

const item = (id: string, overrides: Partial<CompanyOutreachItem> = {}): CompanyOutreachItem => ({
  id,
  candidateUserId: CANDIDATE,
  candidateName: "Ada Lovelace",
  jobPostId: JOB,
  jobTitle: "Backend Engineer",
  subject: "Backend role",
  status: "sent",
  source: "agent",
  sentAt: "2026-10-01T09:00:00.000Z",
  respondedAt: null,
  expiresAt: "2026-10-31T09:00:00.000Z",
  ...overrides,
});

let supabase: SupabaseMock;
let tools: ReturnType<typeof createOutreachTools>;

beforeEach(() => {
  vi.clearAllMocks();
  supabase = createSupabaseMock();
  tools = createOutreachTools(recruiterToolContext(supabase.client));
});

describe("outreach tool schemas", () => {
  it("never take a company, user or source (RA-SEC-002)", async () => {
    for (const [name, tool] of Object.entries(tools)) {
      expect(JSON.stringify(await inputJsonSchema(tool)), name).not.toMatch(/company_?id|user_?id|source/i);
    }
  });

  it("sends to one candidate, with a subject up to 120 and a message up to 2,000 (RA-SEC-006)", async () => {
    expect((await validateInput(tools.sendOutreach, INPUT)).success).toBe(true);
    expect((await validateInput(tools.sendOutreach, { ...INPUT, jobPostId: undefined })).success).toBe(true);
    expect((await validateInput(tools.sendOutreach, { ...INPUT, candidateId: [CANDIDATE] })).success).toBe(false);
    expect((await validateInput(tools.sendOutreach, { ...INPUT, subject: "" })).success).toBe(false);
    expect((await validateInput(tools.sendOutreach, { ...INPUT, subject: "s".repeat(121) })).success).toBe(false);
    expect((await validateInput(tools.sendOutreach, { ...INPUT, message: "m".repeat(2001) })).success).toBe(false);
  });

  it("lists up to 25 rows", async () => {
    expect((await validateInput(tools.listOutreach, { limit: 25 })).success).toBe(true);
    expect((await validateInput(tools.listOutreach, { limit: 26 })).success).toBe(false);
    expect((await validateInput(tools.listOutreach, { status: "hacked" })).success).toBe(false);
  });
});

describe("sendOutreach tool", () => {
  it("sends through the shared core with the session company, user and source agent", async () => {
    const outreach = { ...outreachOf("sent"), id: "f0000000-0000-4000-8000-000000000009", candidate_user_id: CANDIDATE };
    vi.mocked(sendOutreach).mockResolvedValue({ ok: true, outreach, emailed: true });

    const result = await execTool(tools.sendOutreach, INPUT);

    const [deps, input, options] = vi.mocked(sendOutreach).mock.calls[0];
    expect(deps.company.id).toBe(COMPANY_A.id);
    expect(deps.user.id).toBe(COMPANY_A.user.id);
    expect(deps.supabase).toBe(supabase.client);
    expect(input).toEqual(INPUT);
    expect(options).toEqual({ source: "agent" });
    expect(result).toEqual({
      sent: true,
      outreachId: outreach.id,
      status: "sent",
      emailed: true,
      candidateUrl: `/company/profiles/${CANDIDATE}`,
      outreachUrl: "/company/outreach",
    });
    expect(JSON.stringify(result)).not.toMatch(/@/);
  });

  it.each([
    ["ALREADY_OPEN", 409],
    ["NOT_ACCEPTING", 403],
    ["CANDIDATE_LIMIT", 429],
    ["NOT_FOUND", 404],
    ["JOB_NOT_FOUND", 404],
  ] as const)("returns %s as an error the model can explain", async (code, status) => {
    vi.mocked(sendOutreach).mockResolvedValue({ ok: false, code, status, error: `copy for ${code}` });

    expect(await execTool(tools.sendOutreach, INPUT)).toEqual({ error: code, message: `copy for ${code}` });
  });

  it("returns the monthly limit as PLAN_LIMIT with the upgrade link", async () => {
    vi.mocked(sendOutreach).mockResolvedValue({
      ok: false,
      error: { code: "entitlement", key: "outreach", reason: "limit", message: "You've used this month's outreach." },
    } as never);

    expect(await execTool(tools.sendOutreach, INPUT)).toEqual({
      error: "PLAN_LIMIT",
      message: "You've used this month's outreach.",
      upgradeUrl: "/company/billing",
    });
  });

  it("refuses a message that excludes by a protected characteristic (RA-SEC-004)", async () => {
    const result = await execTool(tools.sendOutreach, {
      ...INPUT,
      message: "We're hiring men only for this role. Interested?",
    });

    expect(result).toMatchObject({ error: "NOT_JOB_RELATED" });
    expect(sendOutreach).not.toHaveBeenCalled();
  });

  it("turns an unexpected failure into an error", async () => {
    vi.mocked(sendOutreach).mockRejectedValue(new Error("boom"));

    expect(await execTool(tools.sendOutreach, INPUT)).toMatchObject({ error: expect.any(String) });
  });
});

describe("listOutreach tool", () => {
  it("lists the session company's outreach with the filters and the reply rate", async () => {
    vi.mocked(listCompanyOutreach).mockResolvedValue({
      items: [
        item("o1"),
        item("o2", { status: "interested", respondedAt: "2026-10-02T09:00:00.000Z", candidateName: null }),
      ],
      nextCursor: null,
      replyRate: 0.5,
    });

    const result = await execTool(tools.listOutreach, { jobPostId: JOB, status: "sent" });

    const [deps, filter] = vi.mocked(listCompanyOutreach).mock.calls[0];
    expect(deps.company.id).toBe(COMPANY_A.id);
    expect(filter).toEqual({ jobPostId: JOB, status: "sent" });
    expect(result).toEqual({
      replyRate: 0.5,
      outreach: [
        {
          id: "o1",
          candidate: { id: CANDIDATE, name: "Ada Lovelace", url: `/company/profiles/${CANDIDATE}` },
          job: "Backend Engineer",
          subject: "Backend role",
          status: "sent",
          sentAt: "2026-10-01",
          respondedAt: null,
        },
        {
          id: "o2",
          candidate: { id: CANDIDATE, name: null, url: `/company/profiles/${CANDIDATE}` },
          job: "Backend Engineer",
          subject: "Backend role",
          status: "interested",
          sentAt: "2026-10-01",
          respondedAt: "2026-10-02",
        },
      ],
      hasMore: false,
      url: "/company/outreach",
    });
  });

  it("returns at most limit rows and says there are more", async () => {
    vi.mocked(listCompanyOutreach).mockResolvedValue({
      items: [item("o1"), item("o2"), item("o3")],
      nextCursor: "c",
      replyRate: null,
    });

    const result = (await execTool(tools.listOutreach, { limit: 2 })) as { outreach: unknown[]; hasMore: boolean };

    expect(vi.mocked(listCompanyOutreach).mock.calls[0][1]).toEqual({ jobPostId: null, status: null });
    expect(result.outreach).toHaveLength(2);
    expect(result.hasMore).toBe(true);
  });

  it("turns a failure into an error", async () => {
    vi.mocked(listCompanyOutreach).mockRejectedValue(new Error("Failed to load outreach"));

    expect(await execTool(tools.listOutreach, {})).toMatchObject({ error: expect.any(String) });
  });
});
