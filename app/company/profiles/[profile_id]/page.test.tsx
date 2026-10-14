import { beforeEach, describe, expect, it, vi } from "vitest";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A, PRIVATE_NOT_APPLIED, PUBLIC_APPLICANT } from "@/test/utils/recruiter";
import { RECRUITER_CANDIDATE_COLUMNS } from "@/helpers/profiles/candidate-columns";
import ProfilePage from "./page";

const NOT_FOUND = new Error("NEXT_NOT_FOUND");

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw NOT_FOUND;
  },
  unstable_rethrow: (err: unknown) => {
    if (err === NOT_FOUND) throw err;
  },
}));
vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/components/ProfileClientHydrator", () => ({ default: () => null }));
vi.mock("@/components/Error", () => ({ default: () => null }));

let rls: SupabaseMock;
let service: SupabaseMock;
let createSignedUrl: ReturnType<typeof vi.fn>;

const visit = (profile_id: string) => ProfilePage({ params: Promise.resolve({ profile_id }) });

beforeEach(async () => {
  vi.clearAllMocks();
  rls = createSupabaseMock({ user: COMPANY_A.user });
  rls.queue("company_info", { data: COMPANY_A.infoWithTier, error: null });
  createSignedUrl = vi.fn().mockResolvedValue({ data: { signedUrl: "https://signed" } });
  Object.assign(rls.client, { storage: { from: () => ({ createSignedUrl }) } });
  service = createSupabaseMock();
  service.queue("user_info", {
    data: { ...PUBLIC_APPLICANT.info, resumes: [{ resume_path: "resumes/a/cv.pdf" }] },
    error: null,
  });
  vi.mocked(createServiceRoleClient).mockReturnValue(service.client);
  await setRequestUser(COMPANY_A.user, rls.client);
});

describe("company profile page (RS-TEST-004)", () => {
  it("is not found when the company can't view the candidate, without loading anything", async () => {
    rls.queueRpc("company_can_view_candidate", { data: false, error: null });

    await expect(visit(PRIVATE_NOT_APPLIED.id)).rejects.toBe(NOT_FOUND);

    expect(rls.callsFor("company_can_view_candidate")[0].chain[0].args).toEqual([
      "company_can_view_candidate",
      { p_user_id: PRIVATE_NOT_APPLIED.id },
    ]);
    expect(service.calls).toHaveLength(0);
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it("fails closed when the visibility check errors", async () => {
    rls.queueRpc("company_can_view_candidate", { data: null, error: { message: "boom" } });

    await expect(visit(PUBLIC_APPLICANT.id)).rejects.toBe(NOT_FOUND);
    expect(service.calls).toHaveLength(0);
  });

  it("is not found for a non-UUID id, before any query", async () => {
    await expect(visit("not-a-uuid")).rejects.toBe(NOT_FOUND);

    expect(rls.calls).toHaveLength(0);
    expect(service.calls).toHaveLength(0);
  });

  it("renders a visible candidate with recruiter-safe columns only", async () => {
    rls.queueRpc("company_can_view_candidate", { data: true, error: null });

    await expect(visit(PUBLIC_APPLICANT.id)).resolves.toBeTruthy();

    const [load] = service.callsFor("user_info");
    const select = String(load.chain.find((c) => c.method === "select")?.args[0]);
    expect(select.replace(/\s+/g, " ").trim()).toBe(
      `${RECRUITER_CANDIDATE_COLUMNS}, resumes(resume_path)`,
    );
    expect(load.chain).toContainEqual({ method: "eq", args: ["user_id", PUBLIC_APPLICANT.id] });
    expect(createSignedUrl).toHaveBeenCalledWith("resumes/a/cv.pdf", 3600);
  });
});
