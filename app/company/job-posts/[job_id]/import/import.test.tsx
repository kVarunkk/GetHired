import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import CandidateForm from "@/components/candidates/CandidateForm";
import ResumeImport from "@/components/candidates/ResumeImport";
import SpreadsheetImport from "@/components/candidates/SpreadsheetImport";
import { loadImportPage, type ImportPage } from "@/helpers/candidates/import-page";
import { loadNewCandidatePage } from "@/helpers/candidates/new-candidate";
import { jobImportPath } from "@/helpers/candidates/paths";
import { loadResumeImportPage } from "@/helpers/candidates/resume-import-page";
import { setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock } from "@/test/utils/supabase-mock";
import { HIRING_MANAGER_A, JOB_A1, JOB_A2, memberOf, OWNER_A, type MemberFixture } from "@/test/utils/team";
import { COMPANY_A } from "@/test/utils/recruiter";
import JobImportLayout from "./layout";
import JobImportPage from "./page";
import JobImportResumesPage from "./resumes/page";
import JobImportSpreadsheetPage from "./spreadsheet/page";
import JobImportFormPage from "./form/page";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  }),
  unstable_rethrow: (err: unknown) => {
    if (err instanceof Error && err.message.startsWith("NEXT_")) throw err;
  },
  usePathname: () => "/company/job-posts/x/import/resumes",
}));
vi.mock("@/helpers/candidates/import-page", () => ({ loadImportPage: vi.fn() }));
vi.mock("@/helpers/candidates/resume-import-page", () => ({ loadResumeImportPage: vi.fn() }));
vi.mock("@/helpers/candidates/new-candidate", () => ({ loadNewCandidatePage: vi.fn() }));
vi.mock("@/components/candidates/ResumeImport", () => ({ default: vi.fn(() => <div data-testid="resumes" />) }));
vi.mock("@/components/candidates/SpreadsheetImport", () => ({ default: vi.fn(() => <div data-testid="spreadsheet" />) }));
vi.mock("@/components/candidates/CandidateForm", () => ({ default: vi.fn(() => <div data-testid="form" />) }));

const FIXED = { id: JOB_A1, title: "Backend Engineer", interview: null };
const PAGE: ImportPage = {
  jobs: [],
  stages: [],
  lists: null,
  allowNoJob: true,
  screeningsRemaining: null,
  fixedJob: FIXED,
  notFound: false,
};
const params = (jobId = JOB_A1) => Promise.resolve({ job_id: jobId });

async function signIn(member: MemberFixture = OWNER_A) {
  const db = createSupabaseMock({ user: member.user });
  db.queueRpc("my_company_access", { data: member.membership, error: null });
  await setRequestUser(member.user, db.client);
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(loadImportPage).mockResolvedValue(PAGE);
  vi.mocked(loadNewCandidatePage).mockResolvedValue(PAGE);
  vi.mocked(loadResumeImportPage).mockResolvedValue({ ...PAGE, open: null });
  await signIn();
});

describe("a job's Import candidates section (CPT-019, CP-REQ-020/021)", () => {
  it("frames the methods with the section header and tabs", async () => {
    render(await JobImportLayout({ params: params(), children: <p>Method</p> }));
    expect(screen.getByRole("heading", { name: "Import candidates" })).toBeInTheDocument();
    expect(screen.getByText("Add people who applied outside GetHired. No one is emailed.")).toBeInTheDocument();
    expect(screen.getAllByRole("link").map((l) => l.getAttribute("href"))).toEqual([
      jobImportPath(JOB_A1, "resumes"),
      jobImportPath(JOB_A1, "spreadsheet"),
      jobImportPath(JOB_A1, "form"),
    ]);
    expect(screen.getByText("Method")).toBeInTheDocument();
  });

  it("is a 404 without applicants.import for the job", async () => {
    await signIn(HIRING_MANAGER_A);
    await expect(JobImportLayout({ params: params(), children: null })).rejects.toThrow("NEXT_NOT_FOUND");
    await signIn(memberOf(COMPANY_A, "member", { assignedJobIds: [JOB_A1] }));
    await expect(JobImportLayout({ params: params(JOB_A2), children: null })).rejects.toThrow("NEXT_NOT_FOUND");
    await signIn(memberOf(COMPANY_A, "member", { assignedJobIds: [JOB_A1] }));
    await expect(JobImportLayout({ params: params(JOB_A1), children: null })).resolves.toBeTruthy();
    await expect(JobImportLayout({ params: params("nope"), children: null })).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("opens on Resumes, keeping the query", async () => {
    await expect(JobImportPage({ params: params(), searchParams: Promise.resolve({}) })).rejects.toThrow(
      `NEXT_REDIRECT ${jobImportPath(JOB_A1, "resumes")}`,
    );
    await expect(
      JobImportPage({ params: params(), searchParams: Promise.resolve({ batch: "b1", x: ["1", "2"] }) }),
    ).rejects.toThrow(`NEXT_REDIRECT ${jobImportPath(JOB_A1, "resumes")}?batch=b1&x=1&x=2`);
  });

  it("renders each method with the job fixed", async () => {
    render(await JobImportResumesPage({ params: params() }));
    expect(screen.getByTestId("resumes")).toBeInTheDocument();
    expect(vi.mocked(loadResumeImportPage).mock.calls[0][2]).toEqual({ userId: OWNER_A.user.id, jobId: JOB_A1 });
    expect(vi.mocked(ResumeImport).mock.calls[0][0]).toMatchObject({ page: { fixedJob: FIXED }, initial: null });

    await signIn();
    render(await JobImportSpreadsheetPage({ params: params() }));
    expect(vi.mocked(loadImportPage).mock.calls[0][2]).toEqual({ jobId: JOB_A1 });
    expect(vi.mocked(SpreadsheetImport).mock.calls[0][0]).toMatchObject({ page: { fixedJob: FIXED } });

    await signIn();
    render(await JobImportFormPage({ params: params() }));
    expect(vi.mocked(loadNewCandidatePage).mock.calls[0][2]).toBe(JOB_A1);
    expect(vi.mocked(CandidateForm).mock.calls[0][0]).toMatchObject({
      page: { fixedJob: FIXED },
      cancelHref: `/company/job-posts/${JOB_A1}/applications`,
    });
  });

  it("is a 404 for another company's job", async () => {
    vi.mocked(loadResumeImportPage).mockResolvedValue({ ...PAGE, fixedJob: null, notFound: true, open: null });
    vi.mocked(loadImportPage).mockResolvedValue({ ...PAGE, fixedJob: null, notFound: true });
    vi.mocked(loadNewCandidatePage).mockResolvedValue({ ...PAGE, fixedJob: null, notFound: true });
    await expect(JobImportResumesPage({ params: params() })).rejects.toThrow("NEXT_NOT_FOUND");
    await signIn();
    await expect(JobImportSpreadsheetPage({ params: params() })).rejects.toThrow("NEXT_NOT_FOUND");
    await signIn();
    await expect(JobImportFormPage({ params: params() })).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
