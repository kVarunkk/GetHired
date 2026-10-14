import { beforeEach, describe, expect, it, vi } from "vitest";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A, PRIVATE_NOT_APPLIED, PUBLIC_APPLICANT } from "@/test/utils/recruiter";
import { RECRUITER_CANDIDATE_COLUMNS } from "@/helpers/profiles/candidate-columns";
import { render, screen } from "@testing-library/react";
import { JOB_POST, explanationOf } from "@/test/utils/matching";
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
vi.mock("@/hooks/useEntitlementError", () => ({
  useEntitlementError: () => ({ handle: vi.fn(), show: vi.fn(), dialog: null }),
}));

let rls: SupabaseMock;
let service: SupabaseMock;
let createSignedUrl: ReturnType<typeof vi.fn>;

const visit = (profile_id: string, searchParams: Record<string, string> = {}) =>
  ProfilePage({ params: Promise.resolve({ profile_id }), searchParams: Promise.resolve(searchParams) });

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

describe("company profile page match card (MT-REQ-004)", () => {
  const inJob = () => visit(PUBLIC_APPLICANT.id, { job_post: JOB_POST.id });

  it("shows the score and the stored explanation for the company's job", async () => {
    rls.queueRpc("company_can_view_candidate", { data: true, error: null });
    rls.queue("job_postings", { data: { id: JOB_POST.id, title: JOB_POST.title }, error: null });
    rls.queue("job_relevant_profiles", {
      data: { match_score: 82, explanation: explanationOf(), explanation_status: "completed" },
      error: null,
    });

    render(await inJob());

    expect(screen.getByText("Why this candidate")).toBeInTheDocument();
    expect(screen.getByText(explanationOf().summary)).toBeInTheDocument();
    expect(screen.getByText("82 · Strong")).toBeInTheDocument();
    const jobQuery = rls.callsFor("job_postings")[0];
    expect(jobQuery.chain).toContainEqual({ method: "eq", args: ["company_id", COMPANY_A.id] });
    expect(rls.callsFor("job_relevant_profiles")[0].chain).toContainEqual({
      method: "eq",
      args: ["user_id", PUBLIC_APPLICANT.id],
    });
  });

  it("offers 'Why this match?' when there's no completed explanation", async () => {
    rls.queueRpc("company_can_view_candidate", { data: true, error: null });
    rls.queue("job_postings", { data: { id: JOB_POST.id, title: JOB_POST.title }, error: null });
    rls.queue("job_relevant_profiles", {
      data: { match_score: 70, explanation: explanationOf(), explanation_status: "stale" },
      error: null,
    });

    render(await inJob());

    expect(screen.getByRole("button", { name: "Why this match?" })).toBeInTheDocument();
  });

  it("shows no card for another company's job", async () => {
    rls.queueRpc("company_can_view_candidate", { data: true, error: null });
    rls.queue("job_postings", { data: null, error: null });

    render(await inJob());

    expect(screen.queryByText("Why this candidate")).not.toBeInTheDocument();
    expect(rls.callsFor("job_relevant_profiles")).toHaveLength(0);
  });

  it("ignores a non-UUID job_post", async () => {
    rls.queueRpc("company_can_view_candidate", { data: true, error: null });

    render(await visit(PUBLIC_APPLICANT.id, { job_post: "nope" }));

    expect(rls.callsFor("job_postings")).toHaveLength(0);
    expect(screen.queryByText("Why this candidate")).not.toBeInTheDocument();
  });

  it("shows no card outside job context", async () => {
    rls.queueRpc("company_can_view_candidate", { data: true, error: null });

    render(await visit(PUBLIC_APPLICANT.id));

    expect(rls.callsFor("job_postings")).toHaveLength(0);
  });
});
