import { beforeEach, describe, expect, it, vi } from "vitest";
import { revalidatePath } from "next/cache";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { OWNER_ONLY_MESSAGE } from "@/helpers/companies/permissions";
import { createSupabaseMock } from "@/test/utils/supabase-mock";
import { myCompanyOf } from "@/test/utils/team";
import { COMPANY_A } from "@/test/utils/recruiter";
import { setJobApprovalRequiredAction } from "./set-job-approval-required";

vi.mock("@/helpers/companies/require-company", () => ({ requireCompanyForAction: vi.fn() }));

const company = myCompanyOf(COMPANY_A);
let db = createSupabaseMock({ user: COMPANY_A.user });

beforeEach(() => {
  vi.clearAllMocks();
  db = createSupabaseMock({ user: COMPANY_A.user });
  vi.mocked(requireCompanyForAction).mockResolvedValue({
    ok: true,
    supabase: db.client,
    company,
    user: COMPANY_A.user,
  } as never);
});

describe("setJobApprovalRequiredAction (JLT-052, D7)", () => {
  it("is for owners only", async () => {
    vi.mocked(requireCompanyForAction).mockResolvedValue({ ok: false, error: OWNER_ONLY_MESSAGE } as never);
    expect(await setJobApprovalRequiredAction({ required: true })).toEqual({ ok: false, error: OWNER_ONLY_MESSAGE });
    expect(requireCompanyForAction).toHaveBeenCalledWith({ owner: true });
    expect(db.calls).toHaveLength(0);
  });

  it("writes the session company's setting and revalidates", async () => {
    db.queue("company_info", { data: null, error: null });
    expect(await setJobApprovalRequiredAction({ required: true })).toEqual({ ok: true });

    const [call] = db.callsFor("company_info");
    expect(call.chain).toContainEqual({ method: "update", args: [{ job_approval_required: true }] });
    expect(call.chain).toContainEqual({ method: "eq", args: ["id", company.id] });
    expect(revalidatePath).toHaveBeenCalledWith("/company/settings/jobs");
  });

  it("turns it off with only that column, so pending jobs stay pending", async () => {
    db.queue("company_info", { data: null, error: null });
    await setJobApprovalRequiredAction({ required: false });
    expect(db.callsFor("company_info")[0].chain).toContainEqual({
      method: "update",
      args: [{ job_approval_required: false }],
    });
    expect(db.callsFor("job_postings")).toHaveLength(0);
  });

  it("refuses anything but a boolean", async () => {
    expect(await setJobApprovalRequiredAction({ required: "yes" as never })).toEqual({
      ok: false,
      error: "Invalid setting.",
    });
    expect(db.calls).toHaveLength(0);
  });

  it("reports a failed write", async () => {
    db.queue("company_info", { data: null, error: { message: "boom" } });
    expect(await setJobApprovalRequiredAction({ required: true })).toEqual({
      ok: false,
      error: "Couldn't save the setting. Please try again.",
    });
  });
});
