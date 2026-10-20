import { beforeEach, describe, expect, it, vi } from "vitest";
import { setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { PUBLIC_APPLICANT } from "@/test/utils/recruiter";
import { HIRING_MANAGER_A, JOB_A1, OWNER_A, memberWith, type MemberFixture } from "@/test/utils/team";
import { getEntitlements, getMemberLimit } from "@/helpers/billing/entitlements";
import { loadVisibleCandidates } from "@/helpers/profiles/visible-candidates";
import { outreachStatusFor } from "@/helpers/outreach/list";
import { loadOutreachComposerAction } from "./load-composer";

vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/helpers/billing/entitlements", () => ({ getEntitlements: vi.fn(), getMemberLimit: vi.fn() }));
vi.mock("@/helpers/profiles/visible-candidates", () => ({ loadVisibleCandidates: vi.fn() }));
vi.mock("@/helpers/outreach/list", () => ({ outreachStatusFor: vi.fn() }));

let db: SupabaseMock;

async function signInAs(member: MemberFixture) {
  db = createSupabaseMock({ user: member.user });
  db.queueRpc("my_company_access", { data: member.membership, error: null });
  db.queue("job_postings", { data: [{ id: JOB_A1, title: "Frontend Engineer" }], error: null });
  db.queue("company_email_templates", { data: [], error: null });
  db.queue("company_info", { data: { scheduling_url: null }, error: null });
  await setRequestUser(member.user, db.client);
}

const input = { candidateId: PUBLIC_APPLICANT.id };

beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(loadVisibleCandidates).mockResolvedValue(
    new Map([[PUBLIC_APPLICANT.id, { user_id: PUBLIC_APPLICANT.id, full_name: "Ada Lovelace", accepts_outreach: true }]]),
  );
  vi.mocked(outreachStatusFor).mockResolvedValue({});
  vi.mocked(getEntitlements).mockResolvedValue({
    entitlements: { outreach: { remaining: 12, amount: 150 } },
  } as never);
  vi.mocked(getMemberLimit).mockResolvedValue(null);
  await signInAs(OWNER_A);
});

describe("loadOutreachComposerAction", () => {
  it("lists every active job for a member with outreach.send on all jobs", async () => {
    const result = await loadOutreachComposerAction(input);

    expect(result).toMatchObject({ ok: true, jobs: [{ id: JOB_A1, title: "Frontend Engineer" }], memberCap: null });
    const chain = db.callsFor("job_postings")[0].chain;
    expect(chain).toContainEqual({ method: "eq", args: ["status", "active"] });
    expect(chain.some((c) => c.method === "in")).toBe(false);
  });

  it("lists only the assigned jobs for a job-scoped member (RPT-053)", async () => {
    await signInAs(HIRING_MANAGER_A);

    await loadOutreachComposerAction(input);

    expect(db.callsFor("job_postings")[0].chain).toContainEqual({ method: "in", args: ["id", [JOB_A1]] });
  });

  it("returns the session member's remaining cap (RP-REQ-044)", async () => {
    const capped = memberWith(["outreach.send"], { limits: { outreach: 50 } });
    await signInAs(capped);
    vi.mocked(getMemberLimit).mockResolvedValue({ limit: 50, used: 48, remaining: 2 });

    const result = await loadOutreachComposerAction(input);

    expect(result).toMatchObject({ ok: true, memberCap: { limit: 50, remaining: 2 } });
    expect(getMemberLimit).toHaveBeenCalledWith(capped.company.id, "outreach", capped.user.id);
  });

  it("leaves the cap out when it can't be read", async () => {
    vi.mocked(getMemberLimit).mockRejectedValue(new Error("down"));

    expect(await loadOutreachComposerAction(input)).toMatchObject({ ok: true, memberCap: null });
  });
});
