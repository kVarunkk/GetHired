import { beforeEach, describe, expect, it, vi } from "vitest";
import { getEntitlements } from "@/helpers/billing/entitlements";
import { setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { OWNER_A } from "@/test/utils/team";
import { COMPANY_A } from "@/test/utils/recruiter";
import { previewAgentOutreachAction } from "./preview-agent-outreach";

vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/helpers/billing/entitlements", () => ({ getEntitlements: vi.fn() }));

const CANDIDATE = "a0000000-0000-4000-8000-000000000001";
const JOB = "b0000000-0000-4000-8000-000000000001";
const INPUT = { candidateId: CANDIDATE, jobPostId: JOB, subject: "Backend role", message: "Hi Ada, open to a chat?" };

let db: SupabaseMock;

beforeEach(async () => {
  vi.clearAllMocks();
  db = createSupabaseMock({ user: COMPANY_A.user });
  db.queueRpc("my_company_access", { data: OWNER_A.membership, error: null });
  await setRequestUser(COMPANY_A.user, db.client);
  vi.mocked(getEntitlements).mockResolvedValue({
    entitlements: { outreach: { remaining: 12, amount: 150 } },
  } as never);
});

describe("previewAgentOutreachAction (RAT-053)", () => {
  it("previews the recipient, job, open outreach and quota for the session company", async () => {
    db.queue("candidate_directory", {
      data: [{ user_id: CANDIDATE, full_name: "Ada Lovelace", accepts_outreach: true }],
      error: null,
    });
    db.queue("job_postings", { data: { id: JOB, title: "Backend Engineer" }, error: null });
    db.queue("candidate_outreach", {
      data: [{ id: "o1", candidate_user_id: CANDIDATE, status: "sent", sent_at: "2026-10-10T09:00:00.000Z" }],
      error: null,
    });

    const result = await previewAgentOutreachAction(INPUT);

    expect(result).toEqual({
      ok: true,
      candidateName: "Ada Lovelace",
      acceptsOutreach: true,
      jobTitle: "Backend Engineer",
      jobFound: true,
      openSince: "2026-10-10T09:00:00.000Z",
      quota: { remaining: 12, amount: 150 },
    });
    expect(db.callsFor("job_postings")[0].chain).toContainEqual({ method: "eq", args: ["company_id", COMPANY_A.id] });
    expect(getEntitlements).toHaveBeenCalledWith(COMPANY_A.id);
    // Directory columns only: no contact details reach the card.
    expect(JSON.stringify(db.callsFor("candidate_directory")[0].chain)).not.toMatch(/email|phone|linkedin|github/);
  });

  it("flags a job outside the company and a candidate who doesn't accept outreach", async () => {
    db.queue("candidate_directory", {
      data: [{ user_id: CANDIDATE, full_name: "Ada Lovelace", accepts_outreach: false }],
      error: null,
    });
    db.queue("job_postings", { data: null, error: null });
    db.queue("candidate_outreach", { data: [], error: null });

    expect(await previewAgentOutreachAction(INPUT)).toMatchObject({
      ok: true,
      acceptsOutreach: false,
      jobTitle: null,
      jobFound: false,
      openSince: null,
    });
  });

  it("previews without a job and without a quota when the plan can't load", async () => {
    db.queue("candidate_directory", {
      data: [{ user_id: CANDIDATE, full_name: null, accepts_outreach: null }],
      error: null,
    });
    vi.mocked(getEntitlements).mockRejectedValue(new Error("down"));

    const result = await previewAgentOutreachAction({ ...INPUT, jobPostId: undefined });

    expect(result).toMatchObject({ ok: true, candidateName: null, acceptsOutreach: true, jobFound: true, quota: null });
    expect(db.callsFor("job_postings")).toHaveLength(0);
  });

  it("treats a candidate the company can't see as not found", async () => {
    db.queue("candidate_directory", { data: [], error: null });
    db.queue("user_info", { data: [], error: null });

    expect(await previewAgentOutreachAction(INPUT)).toEqual({ ok: false, error: "This candidate isn't available to contact." });
  });

  it("refuses input the tool wouldn't accept", async () => {
    for (const input of [null, { ...INPUT, candidateId: "x" }, { ...INPUT, subject: "" }]) {
      expect(await previewAgentOutreachAction(input)).toMatchObject({ ok: false });
    }
    expect(db.callsFor("candidate_directory")).toHaveLength(0);
  });
});
