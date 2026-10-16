import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendOutreach } from "@/helpers/outreach/send";
import { listCompanyOutreach } from "@/helpers/outreach/list";
import { isEntitlementPayload } from "@/helpers/billing/errors";
import { mockUser, setRequestUser } from "@/test/utils/auth";
import { buildRequest } from "@/test/utils/request";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A, PUBLIC_APPLICANT } from "@/test/utils/recruiter";
import { OUTREACH_INPUT, outreachOf } from "@/test/utils/outreach";
import { GET, POST } from "./route";

vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/helpers/outreach/send", () => ({ sendOutreach: vi.fn() }));
vi.mock("@/helpers/outreach/list", () => ({ listCompanyOutreach: vi.fn() }));

const ROW = outreachOf("sent");
let db: SupabaseMock;

async function signIn(user = COMPANY_A.user, company: unknown = COMPANY_A.infoWithTier) {
  db = createSupabaseMock({ user });
  db.queue("company_info", { data: company, error: null });
  await setRequestUser(user, db.client);
}

const post = (body: unknown) => POST(buildRequest("/api/company/outreach", { method: "POST", body }));

beforeEach(async () => {
  vi.clearAllMocks();
  await signIn();
});

describe("/api/company/outreach (ORT-030)", () => {
  it("401 signed out", async () => {
    await setRequestUser(null);
    expect((await post(OUTREACH_INPUT)).status).toBe(401);
    expect((await GET(buildRequest("/api/company/outreach"))).status).toBe(401);
  });

  it("403 for an applicant, or a company user without a company (also via a gh_ token)", async () => {
    await signIn(mockUser({ type: "applicant" }));
    expect((await post(OUTREACH_INPUT)).status).toBe(403);
    await signIn(mockUser({ type: "company" }), null);
    expect((await GET(buildRequest("/api/company/outreach"))).status).toBe(403);
    expect(sendOutreach).not.toHaveBeenCalled();
  });

  it("POST sends through the shared helper with source manual", async () => {
    vi.mocked(sendOutreach).mockResolvedValue({ ok: true, outreach: ROW, emailed: true });

    const res = await post(OUTREACH_INPUT);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ outreach: ROW, emailed: true });
    const [deps, input, options] = vi.mocked(sendOutreach).mock.calls[0];
    expect(deps.company.id).toBe(COMPANY_A.id);
    expect(input).toEqual(OUTREACH_INPUT);
    expect(options).toEqual({ source: "manual" });
  });

  it.each([
    ["ALREADY_OPEN", 409],
    ["NOT_ACCEPTING", 403],
    ["CANDIDATE_LIMIT", 429],
    ["NOT_FOUND", 404],
  ] as const)("maps %s to %i", async (code, status) => {
    vi.mocked(sendOutreach).mockResolvedValue({ ok: false, code, status, error: "copy" });

    const res = await post(OUTREACH_INPUT);

    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error: code, message: "copy" });
  });

  it("402 OUTREACH_LIMIT with the entitlement payload at the monthly limit", async () => {
    vi.mocked(sendOutreach).mockResolvedValue({
      ok: false,
      error: {
        code: "entitlement",
        message: "You've used 10 of 10 outreach messages this period.",
        key: "outreach",
        kind: "allowance",
        qty: 1,
        used: 10,
        amount: 10,
        overageCredits: null,
        creditBalance: 0,
        creditsNeeded: 0,
        reason: "limit_reached",
        suggestedTier: null,
      },
    });

    const res = await post(OUTREACH_INPUT);

    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.error).toBe("OUTREACH_LIMIT");
    expect(isEntitlementPayload(body)).toBe(true);
  });

  it("GET returns the page and validates filters", async () => {
    const page = {
      items: [
        {
          id: ROW.id,
          candidateUserId: PUBLIC_APPLICANT.id,
          candidateName: "Ada Lovelace",
          jobPostId: null,
          jobTitle: null,
          subject: ROW.subject,
          status: "sent" as const,
          source: "manual" as const,
          sentAt: ROW.sent_at,
          respondedAt: null,
          expiresAt: ROW.expires_at,
        },
      ],
      nextCursor: null,
      replyRate: 0.5,
    };
    vi.mocked(listCompanyOutreach).mockResolvedValue(page);

    const res = await GET(buildRequest("/api/company/outreach", { searchParams: { status: "sent", cursor: "c" } }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(page);
    expect(JSON.stringify(body)).not.toContain(PUBLIC_APPLICANT.info.email);
    expect(vi.mocked(listCompanyOutreach).mock.calls[0][1]).toEqual({ jobPostId: null, status: "sent", cursor: "c" });

    await signIn();
    expect((await GET(buildRequest("/api/company/outreach", { searchParams: { status: "nope" } }))).status).toBe(400);
    await signIn();
    expect((await GET(buildRequest("/api/company/outreach", { searchParams: { jobPostId: "x" } }))).status).toBe(400);
  });
});
