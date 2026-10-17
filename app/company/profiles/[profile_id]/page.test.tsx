import { beforeEach, describe, expect, it, vi } from "vitest";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { OWNER_A } from "@/test/utils/team";
import { COMPANY_A, PRIVATE_NOT_APPLIED, PUBLIC_APPLICANT } from "@/test/utils/recruiter";
import {
  DIRECTORY_CANDIDATE_COLUMNS,
  RECRUITER_CANDIDATE_COLUMNS,
} from "@/helpers/profiles/candidate-columns";
import { flushAfter } from "@/test/utils/after";
import ProfileClientHydrator from "@/components/ProfileClientHydrator";
import DirectoryProfile from "@/components/outreach/DirectoryProfile";
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
vi.mock("@/components/ProfileClientHydrator", () => ({ default: vi.fn(() => null) }));
vi.mock("@/components/outreach/DirectoryProfile", () => ({ default: vi.fn(() => null) }));
vi.mock("@/components/outreach/ReachOutButton", () => ({ default: () => null }));
vi.mock("@/components/Error", () => ({ default: () => null }));
vi.mock("@/hooks/useEntitlementError", () => ({
  useEntitlementError: () => ({ handle: vi.fn(), show: vi.fn(), dialog: null }),
}));

/** Only the directory columns of a user_info row, as the cached loader selects them. */
const directoryColumnsOf = (row: Record<string, unknown>) =>
  Object.fromEntries(DIRECTORY_CANDIDATE_COLUMNS.split(", ").map((c) => [c, row[c]]));

let rls: SupabaseMock;
let service: SupabaseMock;
let createSignedUrl: ReturnType<typeof vi.fn>;

const visit = (profile_id: string, searchParams: Record<string, string> = {}) =>
  ProfilePage({ params: Promise.resolve({ profile_id }), searchParams: Promise.resolve(searchParams) });

beforeEach(async () => {
  vi.clearAllMocks();
  rls = createSupabaseMock({ user: COMPANY_A.user });
  rls.queueRpc("my_company_access", { data: OWNER_A.membership, error: null });
  createSignedUrl = vi.fn().mockResolvedValue({ data: { signedUrl: "https://signed" } });
  Object.assign(rls.client, { storage: { from: () => ({ createSignedUrl }) } });
  service = createSupabaseMock();
  service.queue("user_info", {
    data: {
      ...directoryColumnsOf(PUBLIC_APPLICANT.info),
      resumes: [{ is_primary: true, resume_public_sections: { sections: [{ type: "skills", items: [] }] } }],
    },
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

});

describe("company profile page shapes (ORT-044, OR-TEST-004)", () => {
  const CONTACT = ["email", "linkedin_url", "github_url", "resume_path", "resumes", "signedUrl"];

  it("renders the directory profile without access: no contact props, no signed URL", async () => {
    rls.queueRpc("company_can_view_candidate", { data: true, error: null });
    rls.queueRpc("company_has_candidate_access", { data: false, error: null });

    render(await visit(PUBLIC_APPLICANT.id));

    expect(DirectoryProfile).toHaveBeenCalled();
    expect(ProfileClientHydrator).not.toHaveBeenCalled();
    const props = vi.mocked(DirectoryProfile).mock.calls[0][0].profile as Record<string, unknown>;
    expect(Object.keys(props).sort()).toMatchInlineSnapshot(`
      [
        "accepts_outreach",
        "career_goals_long_term",
        "career_goals_short_term",
        "company_size_preference",
        "created_at",
        "desired_roles",
        "experience_years",
        "filled",
        "full_name",
        "industry_preferences",
        "is_public",
        "job_type",
        "max_salary",
        "min_salary",
        "preferred_locations",
        "resume_sections",
        "salary_currency",
        "top_skills",
        "updated_at",
        "user_id",
        "visa_sponsorship_required",
        "work_style_preferences",
      ]
    `);
    for (const key of CONTACT) expect(props).not.toHaveProperty(key);
    expect(props.resume_sections).toEqual([{ type: "skills", items: [] }]);
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it("caches only directory columns, with the service role", async () => {
    rls.queueRpc("company_can_view_candidate", { data: true, error: null });
    rls.queueRpc("company_has_candidate_access", { data: false, error: null });

    await visit(PUBLIC_APPLICANT.id);

    const [load] = service.callsFor("user_info");
    const select = String(load.chain.find((c) => c.method === "select")?.args[0]);
    expect(select).toBe(`${DIRECTORY_CANDIDATE_COLUMNS}, resumes(is_primary, resume_public_sections(sections))`);
    expect(select).not.toMatch(/email|linkedin|github|resume_path/);
    expect(load.chain).toContainEqual({ method: "eq", args: ["user_id", PUBLIC_APPLICANT.id] });
    expect(rls.callsFor("user_info")).toHaveLength(0);
  });

  it("renders the full profile with access, through the RLS client and uncached", async () => {
    rls.queueRpc("company_can_view_candidate", { data: true, error: null });
    rls.queueRpc("company_has_candidate_access", { data: true, error: null });
    rls.queue("user_info", {
      data: { ...PUBLIC_APPLICANT.info, resumes: [{ resume_path: "resumes/a/cv.pdf" }] },
      error: null,
    });

    render(await visit(PUBLIC_APPLICANT.id));

    expect(service.callsFor("user_info")).toHaveLength(0);
    const select = String(rls.callsFor("user_info")[0].chain.find((c) => c.method === "select")?.args[0]);
    expect(select).toBe(`${RECRUITER_CANDIDATE_COLUMNS}, resumes(resume_path)`);
    expect(createSignedUrl).toHaveBeenCalledWith("resumes/a/cv.pdf", 3600);
    expect(DirectoryProfile).not.toHaveBeenCalled();
    const props = vi.mocked(ProfileClientHydrator).mock.calls[0][0].applicantProfile;
    expect(props).toMatchObject({ email: PUBLIC_APPLICANT.info.email, signedUrl: "https://signed" });
  });

  it("falls back to the directory profile when the access check errors", async () => {
    rls.queueRpc("company_can_view_candidate", { data: true, error: null });
    rls.queueRpc("company_has_candidate_access", { data: null, error: { message: "boom" } });

    render(await visit(PUBLIC_APPLICANT.id));

    expect(DirectoryProfile).toHaveBeenCalled();
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it("records one view after rendering, and never fails the page when it errors (ORT-051)", async () => {
    rls.queueRpc("company_can_view_candidate", { data: true, error: null });
    rls.queueRpc("company_has_candidate_access", { data: false, error: null });
    rls.queueRpc("record_profile_view", () => {
      throw new Error("boom");
    });

    await expect(visit(PUBLIC_APPLICANT.id)).resolves.toBeTruthy();
    expect(rls.callsFor("record_profile_view")).toHaveLength(0);
    await flushAfter();

    expect(rls.callsFor("record_profile_view")).toHaveLength(1);
    expect(rls.callsFor("record_profile_view")[0].chain[0].args[1]).toEqual({ p_candidate: PUBLIC_APPLICANT.id });
  });

  it("records no view for a candidate the company can't see", async () => {
    rls.queueRpc("company_can_view_candidate", { data: false, error: null });
    await expect(visit(PRIVATE_NOT_APPLIED.id)).rejects.toBe(NOT_FOUND);
    await flushAfter();
    expect(rls.callsFor("record_profile_view")).toHaveLength(0);
  });
});

describe("company profile page matches (MT-REQ-004)", () => {
  const OTHER_JOB = { id: "b0000000-0000-4000-8000-0000000000b2", title: "Backend Engineer" };
  const THIRD_JOB = { id: "b0000000-0000-4000-8000-0000000000b3", title: "Site Reliability Engineer" };
  const row = (job: { id: string; title: string }, score: number | null, status = "none", explanation: unknown = null) => ({
    match_score: score,
    explanation,
    explanation_status: status,
    job_postings: job,
  });
  const matched = (rows: unknown[]) => rls.queue("job_relevant_profiles", { data: rows, error: null });
  const order = () =>
    screen.getAllByRole("listitem").map((li) => li.querySelector("button")?.textContent ?? "");

  beforeEach(() => {
    rls.queueRpc("company_can_view_candidate", { data: true, error: null });
  });

  it("lists every one of the company's jobs the candidate matches, highest score first", async () => {
    matched([
      row(OTHER_JOB, 71),
      row({ id: JOB_POST.id, title: JOB_POST.title }, 82, "completed", explanationOf()),
      row(THIRD_JOB, null),
    ]);

    render(await visit(PUBLIC_APPLICANT.id));

    expect(screen.getByRole("heading", { name: /Matches for your jobs/ })).toBeInTheDocument();
    const [first, second, third] = order();
    expect(first).toContain(JOB_POST.title);
    expect(second).toContain("Backend Engineer");
    expect(third).toContain("Site Reliability Engineer");
    const query = rls.callsFor("job_relevant_profiles")[0].chain;
    expect(query).toContainEqual({ method: "eq", args: ["user_id", PUBLIC_APPLICANT.id] });
    expect(query).toContainEqual({ method: "eq", args: ["job_postings.company_id", COMPANY_A.id] });
    expect(order()).toHaveLength(3);
  });

  it("shows only the job in context, opened", async () => {
    matched([
      row(OTHER_JOB, 90, "completed", explanationOf({ summary: "Backend summary." })),
      row({ id: JOB_POST.id, title: JOB_POST.title }, 82, "completed", explanationOf()),
    ]);

    render(await visit(PUBLIC_APPLICANT.id, { job_post: JOB_POST.id }));

    expect(order()[0]).toContain(JOB_POST.title);
    expect(screen.queryByText("Backend Engineer")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: new RegExp(JOB_POST.title) })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Why this candidate")).toBeInTheDocument();
    expect(screen.getAllByText(explanationOf().summary).length).toBeGreaterThan(0);
    expect(rls.callsFor("job_postings")).toHaveLength(0);
  });

  it("treats a stale explanation as missing, so it can be regenerated", async () => {
    matched([row({ id: JOB_POST.id, title: JOB_POST.title }, 70, "stale", explanationOf())]);

    render(await visit(PUBLIC_APPLICANT.id, { job_post: JOB_POST.id }));

    expect(screen.getByRole("button", { name: "Why this match?" })).toBeInTheDocument();
    expect(screen.queryByText(explanationOf().summary)).not.toBeInTheDocument();
  });

  it("adds the company's job in context when the candidate wasn't matched to it", async () => {
    matched([row(OTHER_JOB, 71)]);
    rls.queue("job_postings", { data: { id: JOB_POST.id, title: JOB_POST.title }, error: null });

    render(await visit(PUBLIC_APPLICANT.id, { job_post: JOB_POST.id }));

    expect(order()).toHaveLength(1);
    expect(order()[0]).toContain(JOB_POST.title);
    expect(order()[0]).toContain("Not scored");
    expect(screen.getByRole("button", { name: "Why this match?" })).toBeInTheDocument();
    expect(rls.callsFor("job_postings")[0].chain).toContainEqual({
      method: "eq",
      args: ["company_id", COMPANY_A.id],
    });
  });

  it("shows no section for another company's job in context", async () => {
    matched([row(OTHER_JOB, 71)]);
    rls.queue("job_postings", { data: null, error: null });

    render(await visit(PUBLIC_APPLICANT.id, { job_post: JOB_POST.id }));

    expect(screen.queryByRole("heading", { name: /Matches for your jobs/ })).not.toBeInTheDocument();
    expect(screen.queryByText(JOB_POST.title)).not.toBeInTheDocument();
  });

  it("ignores a non-UUID job_post", async () => {
    matched([]);

    render(await visit(PUBLIC_APPLICANT.id, { job_post: "nope" }));

    expect(rls.callsFor("job_postings")).toHaveLength(0);
    expect(screen.queryByRole("heading", { name: /Matches for your jobs/ })).not.toBeInTheDocument();
  });

  it("shows no section when the candidate matches none of the company's jobs", async () => {
    matched([]);

    render(await visit(PUBLIC_APPLICANT.id));

    expect(screen.queryByRole("heading", { name: /Matches for your jobs/ })).not.toBeInTheDocument();
  });

  it("still renders the profile when the matches query fails", async () => {
    rls.queue("job_relevant_profiles", { data: null, error: { message: "boom" } });

    render(await visit(PUBLIC_APPLICANT.id));

    expect(screen.queryByRole("heading", { name: /Matches for your jobs/ })).not.toBeInTheDocument();
  });
});
