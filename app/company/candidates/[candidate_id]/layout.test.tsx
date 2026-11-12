import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { notFound } from "next/navigation";
import { TooltipProvider } from "@/components/ui/tooltip";
import { loadCandidateFrame, type CandidateFrame } from "@/helpers/candidates/candidate-page";
import { candidateOf } from "@/test/utils/candidates";
import { createSupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A } from "@/test/utils/recruiter";
import { memberWith, OWNER_A } from "@/test/utils/team";
import CandidateLayout from "./layout";
import CandidateOverviewPage from "./page";
import CandidateApplicationsPage from "./applications/page";
import CandidateResumePage from "./resume/page";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", async (orig) => ({
  ...(await orig()),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  unstable_rethrow: (err: unknown) => {
    throw err;
  },
  usePathname: () => "/company/candidates/x",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/helpers/candidates/candidate-page", async (orig) => ({
  ...(await orig()),
  loadCandidateFrame: vi.fn(),
}));
vi.mock("@/app/actions/candidates/update-candidate", () => ({ updateCandidateAction: vi.fn() }));
vi.mock("@/app/actions/candidates/delete-candidates", () => ({ deleteCandidatesAction: vi.fn() }));
vi.mock("@/app/actions/candidates/add-candidates-to-job", () => ({ addCandidatesToJobAction: vi.fn() }));

const row = candidateOf(COMPANY_A, {
  full_name: "Meera Iyer",
  current_title: "Backend Engineer",
  current_company: "Acme",
});
const JOB = "b0000000-0000-4000-8000-0000000000a1";

function frameOf(overrides: Partial<CandidateFrame> = {}, candidate: Partial<CandidateFrame["candidate"]> = {}) {
  return {
    supabase: createSupabaseMock().client,
    company: OWNER_A.myCompany,
    candidate: { ...row, sourceFile: "people.csv", ...candidate },
    applications: [
      {
        id: "ea000000-0000-4000-8000-000000000001",
        jobId: JOB,
        jobTitle: "Backend Engineer",
        stageName: "Screening",
        stageKind: "screening",
        createdAt: "2026-10-25T00:00:00.000Z",
      },
    ],
    jobs: [{ id: "b0000000-0000-4000-8000-0000000000a2", title: "Frontend Engineer" }],
    canAddToJob: true,
    importJobCount: 2,
    canEdit: true,
    canDelete: true,
    ...overrides,
  } as CandidateFrame;
}

const params = Promise.resolve({ candidate_id: row.id });

async function renderLayout() {
  render(<TooltipProvider>{await CandidateLayout({ params, children: <p>Section</p> })}</TooltipProvider>);
  return screen.getAllByRole("navigation", { name: "Candidate sections" })[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadCandidateFrame).mockResolvedValue(frameOf());
});

describe("candidate page layout (BI-REQ-004)", () => {
  it("frames the sections with the name, role and actions, back to Candidates", async () => {
    const nav = await renderLayout();

    expect(within(nav).getAllByRole("link").map((l) => l.getAttribute("href"))).toEqual([
      "/company/candidates",
      `/company/candidates/${row.id}`,
      `/company/candidates/${row.id}/applications`,
      `/company/candidates/${row.id}/resume`,
    ]);
    expect(within(nav).getByRole("link", { name: "Applications (1)" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Meera Iyer");
    expect(screen.getByText("Backend Engineer at Acme")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add to a job" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
    expect(screen.getByText("Section")).toBeInTheDocument();
  });

  it("404s for a candidate the viewer can't read (another company's, or no access)", async () => {
    vi.mocked(loadCandidateFrame).mockResolvedValue(null);

    await expect(CandidateLayout({ params, children: null })).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(CandidateOverviewPage({ params })).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(CandidateApplicationsPage({ params })).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(CandidateResumePage({ params })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalledTimes(4);
  });

  it("marks a claimed or unsubscribed candidate", async () => {
    vi.mocked(loadCandidateFrame).mockResolvedValue(
      frameOf({}, { claimed_user_id: "a1000000-0000-4000-8000-000000000001", email_opted_out_at: "2026-10-24T00:00:00.000Z" }),
    );
    await renderLayout();

    const title = screen.getByRole("heading", { level: 1 });
    expect(title).toHaveTextContent("Joined GetHired");
    expect(title).toHaveTextContent("Unsubscribed");
  });

  it("leaves out the actions the member can't take", async () => {
    vi.mocked(loadCandidateFrame).mockResolvedValue(frameOf({ jobs: [], canAddToJob: false, importJobCount: 0, canEdit: false, canDelete: false }));
    await renderLayout();

    expect(screen.queryByRole("button", { name: "Add to a job" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });
});

describe("candidate overview", () => {
  it("edits the details with applicants.import", async () => {
    render(await CandidateOverviewPage({ params }));

    expect(screen.getByText(/Imported from people.csv on/)).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("Meera Iyer");
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("is read-only without it", async () => {
    vi.mocked(loadCandidateFrame).mockResolvedValue(frameOf({ canEdit: false }));
    render(await CandidateOverviewPage({ params }));

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText(row.email!)).toBeInTheDocument();
  });

  it("says when they joined GetHired, linking their profile, and when they unsubscribed", async () => {
    const userId = "a1000000-0000-4000-8000-000000000001";
    vi.mocked(loadCandidateFrame).mockResolvedValue(
      frameOf(
        {},
        {
          claimed_user_id: userId,
          claimed_at: "2026-10-24T00:00:00.000Z",
          email_opted_out_at: "2026-10-24T00:00:00.000Z",
        },
      ),
    );
    render(await CandidateOverviewPage({ params }));

    expect(screen.getByText(/Joined GetHired with this email on/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open their profile" })).toHaveAttribute(
      "href",
      `/company/profiles/${userId}`,
    );
    expect(screen.getByText(/Unsubscribed from your emails on/)).toHaveTextContent("aren't sent to them");
  });

  it("names a candidate added by hand", async () => {
    vi.mocked(loadCandidateFrame).mockResolvedValue(
      frameOf({}, { sourceFile: null, source_batch_id: "cb000000-0000-4000-8000-000000000001" }),
    );
    render(await CandidateOverviewPage({ params }));

    expect(screen.getByText(/Added by hand on/)).toBeInTheDocument();
  });

  it("says a candidate with nothing to match on can't be matched (CPT-036, CP-REQ-041)", async () => {
    const db = createSupabaseMock();
    db.queue("company_candidates", { data: { resume_content: null }, error: null });
    vi.mocked(loadCandidateFrame).mockResolvedValue({
      ...frameOf({}, { current_title: null, skills: [] }),
      supabase: db.client,
    } as CandidateFrame);
    render(await CandidateOverviewPage({ params }));

    expect(screen.getByText("Add a resume or skills to match this person to jobs.")).toBeInTheDocument();
  });

  it("lists their matching jobs when they can be matched (CPT-055, CP-REQ-062)", async () => {
    const db = createSupabaseMock();
    db.queueRpc("match_jobs_for_company_candidate", {
      data: { ok: true, candidate_embedded: true, matches: [{ job_post_id: JOB, similarity: 0.8 }] },
      error: null,
    });
    db.queue("job_postings", { data: [{ id: JOB, title: "Backend Engineer" }], error: null });
    vi.mocked(loadCandidateFrame).mockResolvedValue({ ...frameOf(), supabase: db.client } as CandidateFrame);
    render(await CandidateOverviewPage({ params }));

    expect(screen.queryByText(/to match this person to jobs/)).not.toBeInTheDocument();
    const section = screen.getByRole("region", { name: "Matching jobs" });
    expect(within(section).getByRole("link", { name: "Backend Engineer" })).toBeInTheDocument();
    expect(within(section).getByRole("button", { name: "Add to Backend Engineer" })).toBeEnabled();
    expect(db.callsFor("match_jobs_for_company_candidate")[0].chain[0].args[1]).toEqual({ p_candidate_id: row.id });
  });

  it("says matching needs an active job when the company has none, without the loader", async () => {
    const db = createSupabaseMock();
    db.queueRpc("match_jobs_for_company_candidate", {
      data: { ok: true, candidate_embedded: false, matches: [] },
      error: null,
    });
    db.queue("job_postings", { data: [], error: null });
    vi.mocked(loadCandidateFrame).mockResolvedValue({ ...frameOf(), supabase: db.client } as CandidateFrame);
    render(await CandidateOverviewPage({ params }));

    const section = screen.getByRole("region", { name: "Matching jobs" });
    expect(within(section).getByText(/You have no active jobs/)).toBeInTheDocument();
    expect(within(section).queryByText(/Finding matching jobs…/)).not.toBeInTheDocument();
    expect(db.callsFor("job_postings")[0].chain).toContainEqual({ method: "eq", args: ["status", "active"] });
  });

  it("doesn't match without talent.view", async () => {
    const db = createSupabaseMock();
    vi.mocked(loadCandidateFrame).mockResolvedValue({
      ...frameOf({ company: memberWith(["applicants.import"]).myCompany }),
      supabase: db.client,
    } as CandidateFrame);
    render(await CandidateOverviewPage({ params }));

    expect(screen.queryByRole("region", { name: "Matching jobs" })).not.toBeInTheDocument();
    expect(db.callsFor("match_jobs_for_company_candidate")).toHaveLength(0);
  });
});

describe("candidate applications and resume", () => {
  it("lists their applications with the stage, linking each one", async () => {
    render(await CandidateApplicationsPage({ params }));

    expect(screen.getByRole("link", { name: "Backend Engineer" })).toHaveAttribute(
      "href",
      "/company/applications/ea000000-0000-4000-8000-000000000001",
    );
    expect(screen.getByText("Screening")).toBeInTheDocument();
  });

  it("says when they're in no job", async () => {
    vi.mocked(loadCandidateFrame).mockResolvedValue(frameOf({ applications: [] }));
    render(await CandidateApplicationsPage({ params }));

    expect(screen.getByText("Not in any of your jobs yet.")).toBeInTheDocument();
  });

  it("says there's no resume yet", async () => {
    render(await CandidateResumePage({ params }));

    expect(screen.getByText(/No resume yet/)).toBeInTheDocument();
  });
});
