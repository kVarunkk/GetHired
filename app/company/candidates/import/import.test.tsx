import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import CandidateForm from "@/components/candidates/CandidateForm";
import ResumeImport from "@/components/candidates/ResumeImport";
import SpreadsheetImport from "@/components/candidates/SpreadsheetImport";
import { loadImportPage, type ImportPage } from "@/helpers/candidates/import-page";
import { loadNewCandidatePage } from "@/helpers/candidates/new-candidate";
import { candidateImportPath, jobImportPath } from "@/helpers/candidates/paths";
import { loadResumeImportPage } from "@/helpers/candidates/resume-import-page";
import { setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock } from "@/test/utils/supabase-mock";
import { JOB_A1, OWNER_A } from "@/test/utils/team";
import ImportCandidatesLayout from "./layout";
import ImportCandidatesPage from "./page";
import ImportResumesPage from "./resumes/page";
import ImportSpreadsheetPage from "./spreadsheet/page";
import NewCandidatePage from "../new/page";

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
  usePathname: () => "/company/candidates/import/resumes",
}));
vi.mock("@/helpers/candidates/import-page", () => ({ loadImportPage: vi.fn() }));
vi.mock("@/helpers/candidates/resume-import-page", () => ({ loadResumeImportPage: vi.fn() }));
vi.mock("@/helpers/candidates/new-candidate", () => ({ loadNewCandidatePage: vi.fn() }));
vi.mock("@/components/candidates/ResumeImport", () => ({ default: vi.fn(() => <div data-testid="resumes" />) }));
vi.mock("@/components/candidates/SpreadsheetImport", () => ({ default: vi.fn(() => <div data-testid="spreadsheet" />) }));
vi.mock("@/components/candidates/CandidateForm", () => ({ default: vi.fn(() => <div data-testid="form" />) }));

const PAGE: ImportPage = {
  jobs: [{ id: JOB_A1, title: "Backend Engineer", interview: null }],
  stages: [],
  lists: null,
  allowNoJob: true,
  screeningsRemaining: null,
  fixedJob: null,
  notFound: false,
};

beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(loadImportPage).mockResolvedValue(PAGE);
  vi.mocked(loadNewCandidatePage).mockResolvedValue(PAGE);
  vi.mocked(loadResumeImportPage).mockResolvedValue({ ...PAGE, open: null });
  const db = createSupabaseMock({ user: OWNER_A.user });
  db.queueRpc("my_company_access", { data: OWNER_A.membership, error: null });
  await setRequestUser(OWNER_A.user, db.client);
});

describe("the Candidates page's import (CPT-020, CP-REQ-030/031)", () => {
  it("frames resumes and spreadsheet tabs under the page header, back to Candidates", () => {
    render(ImportCandidatesLayout({ children: <p>Method</p> }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Import candidates");
    const hrefs = screen.getAllByRole("link").map((l) => l.getAttribute("href"));
    expect(hrefs).toContain("/company/candidates");
    expect(hrefs).toContain(candidateImportPath("resumes"));
    expect(hrefs).toContain(candidateImportPath("spreadsheet"));
    expect(hrefs).not.toContain(jobImportPath(JOB_A1, "form"));
  });

  it("opens on Resumes", () => {
    expect(() => ImportCandidatesPage()).toThrow(`NEXT_REDIRECT ${candidateImportPath("resumes")}`);
  });

  it("imports resumes and spreadsheets with no job fixed", async () => {
    render(await ImportResumesPage());
    expect(vi.mocked(loadResumeImportPage).mock.calls[0][2]).toEqual({ userId: OWNER_A.user.id });
    expect(vi.mocked(ResumeImport).mock.calls[0][0]).toMatchObject({ page: { fixedJob: null } });

    const db = createSupabaseMock({ user: OWNER_A.user });
    db.queueRpc("my_company_access", { data: OWNER_A.membership, error: null });
    await setRequestUser(OWNER_A.user, db.client);
    render(await ImportSpreadsheetPage());
    expect(vi.mocked(loadImportPage).mock.calls[0]).toHaveLength(2);
    expect(SpreadsheetImport).toHaveBeenCalled();
  });

  it("says what's missing without applicants.import", async () => {
    vi.mocked(loadResumeImportPage).mockResolvedValue(null);
    render(await ImportResumesPage());
    expect(screen.getByText(/^Your role can't/)).toBeInTheDocument();
  });
});

describe("/company/candidates/new?job= (CP-REQ-032)", () => {
  it("goes to the job's form when the member can import into it", async () => {
    vi.mocked(loadNewCandidatePage).mockResolvedValue({ ...PAGE, fixedJob: PAGE.jobs[0] });
    await expect(NewCandidatePage({ searchParams: Promise.resolve({ job: JOB_A1 }) })).rejects.toThrow(
      `NEXT_REDIRECT ${jobImportPath(JOB_A1, "form")}`,
    );
  });

  it("ignores a job the member can't import into", async () => {
    vi.mocked(loadNewCandidatePage).mockResolvedValue({ ...PAGE, notFound: true });
    render(await NewCandidatePage({ searchParams: Promise.resolve({ job: JOB_A1 }) }));
    expect(screen.getByTestId("form")).toBeInTheDocument();
    expect(vi.mocked(CandidateForm).mock.calls[0][0]).toMatchObject({
      page: { fixedJob: null },
      cancelHref: "/company/candidates",
    });
  });
});
