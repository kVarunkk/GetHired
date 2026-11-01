import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import toast from "react-hot-toast";
import { deleteCandidatesAction } from "@/app/actions/candidates/delete-candidates";
import { addCandidatesToJobAction } from "@/app/actions/candidates/add-candidates-to-job";
import {
  CANDIDATES_PAGE_SIZE,
  type CandidateFilters,
  type CompanyCandidateListItem,
} from "@/helpers/candidates/list-candidates";
import CompanyCandidatesTable from "./CompanyCandidatesTable";

const push = vi.fn();
const refresh = vi.fn();
let search = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
  usePathname: () => "/company/candidates",
  useSearchParams: () => new URLSearchParams(search),
}));
vi.mock("@/components/ui/select", () => import("@/test/utils/select-mock"));
vi.mock("react-hot-toast", () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/app/actions/candidates/delete-candidates", () => ({ deleteCandidatesAction: vi.fn() }));
vi.mock("@/app/actions/candidates/add-candidates-to-job", () => ({ addCandidatesToJobAction: vi.fn() }));
// Its own tests cover it; here it only has to be there or not.
vi.mock("@/components/pipeline/AddToListMenu", () => ({
  default: ({ companyCandidateId }: { companyCandidateId: string }) => (
    <button type="button">Add {companyCandidateId} to list</button>
  ),
}));

const MEERA: CompanyCandidateListItem = {
  id: "cc000000-0000-4000-8000-000000000001",
  name: "Meera Iyer",
  email: "meera@mail.test",
  title: "Backend Engineer",
  location: "bengaluru",
  tags: ["referral"],
  batch: { id: "cb000000-0000-4000-8000-000000000001", fileName: "people.csv" },
  jobCount: 2,
  createdAt: "2026-10-20T00:00:00.000Z",
  score: null,
};
const RAVI: CompanyCandidateListItem = {
  ...MEERA,
  id: "cc000000-0000-4000-8000-000000000002",
  name: "Ravi Kumar",
  email: null,
  tags: [],
  batch: { id: "cb000000-0000-4000-8000-000000000002", fileName: null },
  jobCount: 0,
};
const JOB = { id: "a0000000-0000-4000-8000-000000000001", title: "Backend Engineer" };
const NO_FILTERS: CandidateFilters = {
  q: null,
  tag: null,
  batchId: null,
  inJob: null,
  loc: null,
  resume: null,
  email: null,
  addedDays: null,
  matchJob: null,
  page: 1,
};

type Props = Parameters<typeof CompanyCandidatesTable>[0];
const renderTable = (props: Partial<Props> = {}) =>
  render(
    <CompanyCandidatesTable
      list={{ items: [MEERA, RAVI], total: 2, page: 1, pageSize: CANDIDATES_PAGE_SIZE }}
      filters={NO_FILTERS}
      options={{ tags: ["referral"], batches: [{ id: MEERA.batch!.id, fileName: "people.csv" }] }}
      jobs={[JOB]}
      canCreate
      canDelete
      canManageLists
      {...props}
    />,
  );

const row = (name: string) => screen.getByRole("link", { name }).closest("tr")!;

beforeEach(() => {
  vi.clearAllMocks();
  search = "";
  vi.mocked(deleteCandidatesAction).mockResolvedValue({ ok: true, deleted: 1 });
  vi.mocked(addCandidatesToJobAction).mockResolvedValue({
    ok: true,
    counts: {
      created: 0,
      updated: 0,
      skipped: 0,
      known: 0,
      added_to_job: 1,
      already_in_job: 0,
      needs_outreach: 0,
      no_email: 0,
      added_to_list: 0,
      not_found: 0,
    },
  });
});

describe("CompanyCandidatesTable (BI-REQ-003)", () => {
  it("shows each candidate's name, email, title, location, tags, file, jobs and date", () => {
    renderTable();

    const meera = within(row("Meera Iyer"));
    expect(screen.getByRole("link", { name: "Meera Iyer" })).toHaveAttribute("href", `/company/candidates/${MEERA.id}`);
    expect(meera.getByText("meera@mail.test")).toBeInTheDocument();
    expect(meera.getByText("Backend Engineer")).toBeInTheDocument();
    expect(meera.getByText("bengaluru")).toBeInTheDocument();
    expect(meera.getByText("referral")).toBeInTheDocument();
    expect(meera.getByText("people.csv")).toBeInTheDocument();
    expect(meera.getByText("2")).toBeInTheDocument();
    expect(within(row("Ravi Kumar")).getByText("Added by hand")).toBeInTheDocument();
  });

  it("pages through the server's results", () => {
    renderTable({ list: { items: [MEERA], total: 26, page: 1, pageSize: CANDIDATES_PAGE_SIZE } });

    expect(screen.getByText("Showing 1-1 of 26 candidates")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(push).toHaveBeenCalledWith("/company/candidates?page=2", { scroll: false });
  });

  it("puts the filters in the URL, back on the first page", async () => {
    search = "page=3";
    renderTable({ filters: { ...NO_FILTERS, page: 3 } });

    fireEvent.change(screen.getByLabelText("Filter by tag"), { target: { value: "referral" } });
    expect(push).toHaveBeenLastCalledWith("/company/candidates?tag=referral", { scroll: false });
    fireEvent.change(screen.getByLabelText("Filter by import file"), { target: { value: MEERA.batch!.id } });
    expect(push).toHaveBeenLastCalledWith(`/company/candidates?batch=${MEERA.batch!.id}`, { scroll: false });
    fireEvent.change(screen.getByLabelText("Filter by jobs"), { target: { value: "no" } });
    expect(push).toHaveBeenLastCalledWith("/company/candidates?inJob=no", { scroll: false });

    fireEvent.change(screen.getByLabelText("Search candidates"), { target: { value: "meera" } });
    await waitFor(() =>
      expect(push).toHaveBeenLastCalledWith("/company/candidates?q=meera", { scroll: false }),
    );
  });

  it("puts the location, resume, email and added filters in the URL (CPT-035, CP-REQ-071)", async () => {
    search = "page=2";
    renderTable({ filters: { ...NO_FILTERS, page: 2 } });

    fireEvent.change(screen.getByLabelText("Filter by resume"), { target: { value: "none" } });
    expect(push).toHaveBeenLastCalledWith("/company/candidates?resume=none", { scroll: false });
    fireEvent.change(screen.getByLabelText("Filter by email"), { target: { value: "has" } });
    expect(push).toHaveBeenLastCalledWith("/company/candidates?email=has", { scroll: false });
    fireEvent.change(screen.getByLabelText("Filter by date added"), { target: { value: "90" } });
    expect(push).toHaveBeenLastCalledWith("/company/candidates?added=90", { scroll: false });

    fireEvent.change(screen.getByLabelText("Filter by location"), { target: { value: "Bangalore" } });
    await waitFor(() =>
      expect(push).toHaveBeenLastCalledWith("/company/candidates?loc=Bangalore", { scroll: false }),
    );
  });

  it("matches to a job the member can view, sorting by similarity (CPT-056, CP-REQ-071)", () => {
    search = "page=2";
    renderTable({ matchJobs: [JOB], filters: { ...NO_FILTERS, page: 2 } });

    expect(screen.queryByRole("columnheader", { name: "Similarity" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Match to job"), { target: { value: JOB.id } });
    expect(push).toHaveBeenLastCalledWith(`/company/candidates?matchJob=${JOB.id}`, { scroll: false });
  });

  it("shows the similarity column while matching", () => {
    renderTable({
      matchJobs: [JOB],
      filters: { ...NO_FILTERS, matchJob: JOB.id },
      list: { items: [{ ...MEERA, score: 91 }], total: 1, page: 1, pageSize: CANDIDATES_PAGE_SIZE },
    });
    expect(screen.getByRole("columnheader", { name: "Similarity" })).toBeInTheDocument();
    expect(within(row("Meera Iyer")).getByText("91")).toBeInTheDocument();
    expect(screen.getByLabelText("Match to job")).toHaveValue(JOB.id);
    expect(screen.getByRole("button", { name: /Clear Filters/ })).toBeInTheDocument();
  });

  it("has no match filter without talent.view or on a list", () => {
    renderTable({ matchJobs: null });
    expect(screen.queryByLabelText("Match to job")).not.toBeInTheDocument();
  });

  it("says the search covers skills", () => {
    renderTable();
    expect(screen.getByLabelText("Search candidates")).toHaveAttribute("placeholder", "Name, email, title or skill");
  });

  it("shows the new filters as set", () => {
    renderTable({ filters: { ...NO_FILTERS, loc: "pune", resume: "has", email: "none", addedDays: 7 } });
    expect(screen.getByLabelText("Filter by location")).toHaveValue("pune");
    expect(screen.getByLabelText("Filter by resume")).toHaveValue("has");
    expect(screen.getByLabelText("Filter by email")).toHaveValue("none");
    expect(screen.getByLabelText("Filter by date added")).toHaveValue("7");
    expect(screen.getByRole("button", { name: /Clear Filters/ })).toBeInTheDocument();
  });

  it("clears the filters", () => {
    search = `tag=referral&inJob=yes&loc=pune&resume=has&email=none&added=30&q=go&matchJob=${JOB.id}`;
    renderTable({
      filters: {
        ...NO_FILTERS,
        q: "go",
        tag: "referral",
        inJob: "yes",
        loc: "pune",
        resume: "has",
        email: "none",
        addedDays: 30,
        matchJob: JOB.id,
      },
      matchJobs: [JOB],
    });

    fireEvent.click(screen.getByRole("button", { name: /Clear Filters/ }));
    expect(push).toHaveBeenLastCalledWith("/company/candidates", { scroll: false });
  });

  it("links to adding one and to importing", () => {
    renderTable();

    expect(screen.getByRole("link", { name: /Add candidate/ })).toHaveAttribute("href", "/company/candidates/new");
    expect(screen.getByRole("link", { name: /Import/ })).toHaveAttribute("href", "/company/candidates/import/resumes");
  });

  it("hides what the member's permissions don't allow", () => {
    renderTable({ canCreate: false, canDelete: false, canManageLists: false, jobs: [] });

    expect(screen.queryByRole("link", { name: /Add candidate/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Import/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Delete/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /to list/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /to a job/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("can't add someone without an email to a job", () => {
    renderTable();

    const add = within(row("Ravi Kumar")).getByRole("button", { name: "Add Ravi Kumar to a job" });
    expect(add).toBeDisabled();
    expect(add.closest("[title]")).toHaveAttribute("title", "Add an email first");
  });

  it("adds a candidate to a job", async () => {
    renderTable();

    fireEvent.click(within(row("Meera Iyer")).getByRole("button", { name: "Add Meera Iyer to a job" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Job"), { target: { value: JOB.id } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add to job" }));

    await waitFor(() =>
      expect(addCandidatesToJobAction).toHaveBeenCalledWith({ jobPostId: JOB.id, candidateIds: [MEERA.id] }),
    );
    expect(toast.success).toHaveBeenCalledWith("1 candidate added to the job");
    expect(refresh).toHaveBeenCalled();
  });

  it("deletes the selected candidates after asking", async () => {
    renderTable();

    fireEvent.click(screen.getByRole("checkbox", { name: "Select Meera Iyer" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Ravi Kumar" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete 2" }));

    const confirm = await screen.findByRole("alertdialog");
    expect(confirm).toHaveTextContent("Delete 2 candidates?");
    expect(deleteCandidatesAction).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole("button", { name: "Delete" }));

    await waitFor(() =>
      expect(deleteCandidatesAction).toHaveBeenCalledWith({ candidateIds: [MEERA.id, RAVI.id] }),
    );
    expect(refresh).toHaveBeenCalled();
  });

  it("deletes one from its row", async () => {
    renderTable();

    fireEvent.click(within(row("Meera Iyer")).getByRole("button", { name: "Delete Meera Iyer" }));
    const confirm = await screen.findByRole("alertdialog");
    expect(confirm).toHaveTextContent("Delete Meera Iyer?");
    fireEvent.click(within(confirm).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(deleteCandidatesAction).toHaveBeenCalledWith({ candidateIds: [MEERA.id] }));
  });

  it("toasts a refusal", async () => {
    vi.mocked(deleteCandidatesAction).mockResolvedValue({ ok: false, error: "Your role can't import applicants here." });
    renderTable();

    fireEvent.click(within(row("Meera Iyer")).getByRole("button", { name: "Delete Meera Iyer" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Your role can't import applicants here."));
    expect(refresh).not.toHaveBeenCalled();
  });

  it("offers add to list per row", () => {
    renderTable();

    expect(within(row("Meera Iyer")).getByRole("button", { name: `Add ${MEERA.id} to list` })).toBeInTheDocument();
  });

  it("says how to start when there's nobody yet", () => {
    renderTable({ list: { items: [], total: 0, page: 1, pageSize: CANDIDATES_PAGE_SIZE } });

    expect(screen.getByText(/No candidates yet/)).toBeInTheDocument();
  });

  it("in a list's tab, shows its members without the add and import links", () => {
    renderTable({ inList: true });

    expect(screen.getByRole("link", { name: "Meera Iyer" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Add candidate/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Import/ })).not.toBeInTheDocument();
  });
});
