import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { CompanyApplicationRow } from "@/helpers/applications/company-list";
import { parseApplicationListParams } from "@/helpers/applications/list-params";
import CompanyApplicationsTable from "./CompanyApplicationsTable";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
  usePathname: () => "/company/applications",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/ui/select", () => import("@/test/utils/select-mock"));

const JOB = { id: "b0000000-0000-4000-8000-000000000001", title: "Backend Engineer" };

const USER_ROW: CompanyApplicationRow = {
  id: "e0000000-0000-4000-8000-000000000001",
  created_at: "2026-11-01T10:00:00.000Z",
  status: "submitted",
  job_post_id: JOB.id,
  job_title: JOB.title,
  person_name: "Ada Lovelace",
  applicant_user_id: "a0000000-0000-4000-8000-000000000001",
  company_candidate_id: null,
  fit_score: 82,
  screening_status: "completed",
  recommendation: "yes",
  knockout_failed: false,
  knockout_reasons: [],
  candidate_has_resume: false,
};
const IMPORTED_ROW: CompanyApplicationRow = {
  ...USER_ROW,
  id: "e0000000-0000-4000-8000-000000000002",
  person_name: "Cara Imported",
  applicant_user_id: null,
  company_candidate_id: "cc000000-0000-4000-8000-000000000001",
  fit_score: null,
  screening_status: null,
  recommendation: null,
  knockout_failed: true,
  knockout_reasons: [{ label: "Has a visa" }],
  candidate_has_resume: false,
};
const CLAIMED_ROW: CompanyApplicationRow = {
  ...USER_ROW,
  id: "e0000000-0000-4000-8000-000000000003",
  person_name: "Vik Claimed",
  applicant_user_id: "a0000000-0000-4000-8000-000000000002",
  company_candidate_id: "cc000000-0000-4000-8000-000000000002",
  candidate_has_resume: true,
  knockout_failed: null,
  knockout_reasons: null,
};

function renderTable({
  rows = [USER_ROW, IMPORTED_ROW, CLAIMED_ROW],
  total = 3,
  page = 1,
  params = {} as Record<string, string>,
} = {}) {
  return render(
    <CompanyApplicationsTable
      list={{ rows, total, page, pageSize: 25, jobs: [JOB] }}
      params={{ ...parseApplicationListParams(params), page }}
    />,
  );
}

beforeEach(() => push.mockReset());
afterEach(() => vi.useRealTimers());

describe("CompanyApplicationsTable (QF-REQ-023/024)", () => {
  it("renders the same cells as the job page's list", () => {
    renderTable();
    const [, ada, cara, vik] = screen.getAllByRole("row");

    expect(within(ada).getByText("Ada Lovelace")).toBeInTheDocument();
    expect(within(ada).getByRole("link", { name: JOB.title })).toHaveAttribute("href", `/company/job-posts/${JOB.id}`);
    expect(within(ada).getByLabelText(/Match score 82 out of 100/)).toBeInTheDocument();
    expect(within(ada).queryByText("Imported")).not.toBeInTheDocument();
    expect(within(ada).getByRole("link", { name: /View Application/ })).toHaveAttribute(
      "href",
      `/company/applications/${USER_ROW.id}`,
    );

    expect(within(cara).getByText("Imported")).toBeInTheDocument();
    expect(within(cara).getByText("No resume")).toBeInTheDocument();
    expect(within(cara).getByText(/Didn.t meet requirements/)).toHaveAttribute("title", "Didn't meet: Has a visa");

    expect(within(vik).getByText("Imported")).toBeInTheDocument();
    expect(within(vik).queryByText("No resume")).not.toBeInTheDocument();
    expect(within(vik).getByRole("link", { name: "GetHired account connected" })).toHaveAttribute(
      "href",
      `/company/profiles/${CLAIMED_ROW.applicant_user_id}`,
    );
  });

  it.each([
    ["Filter by job", JOB.id, `?job=${JOB.id}`],
    ["Filter by status", "rejected", "?status=rejected"],
    ["Filter by recommendation", "strong_yes", "?recommendation=strong_yes"],
    ["Filter by requirements", "failed", "?knockout=failed"],
  ])("%s writes the URL and goes back to page 1", (label, value, query) => {
    renderTable({ page: 3, total: 80 });

    fireEvent.change(screen.getByLabelText(label), { target: { value } });

    expect(push).toHaveBeenCalledWith(`/company/applications${query}`, { scroll: false });
  });

  it("debounces the name search by 300 ms", () => {
    vi.useFakeTimers();
    renderTable({ page: 2, total: 40 });

    fireEvent.change(screen.getByLabelText("Search by name"), { target: { value: "ad" } });
    fireEvent.change(screen.getByLabelText("Search by name"), { target: { value: "ada" } });
    act(() => vi.advanceTimersByTime(299));
    expect(push).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));

    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("/company/applications?q=ada", { scroll: false });
  });

  it("sorts by a header, and flips the direction on a second click", () => {
    renderTable();
    fireEvent.click(screen.getByRole("button", { name: /Fit/ }));
    expect(push).toHaveBeenLastCalledWith("/company/applications?sort=fit_score", { scroll: false });
  });

  it("flips the direction of the current sort", () => {
    renderTable({ params: { sort: "fit_score" } });
    fireEvent.click(screen.getByRole("button", { name: /Fit/ }));
    expect(push).toHaveBeenLastCalledWith("/company/applications?sort=fit_score&dir=asc", { scroll: false });
  });

  it("Clear Filters removes every parameter", () => {
    renderTable({ params: { q: "ada", status: "rejected", sort: "person_name" }, page: 2, total: 40 });

    fireEvent.click(screen.getByRole("button", { name: "Clear Filters" }));

    expect(push).toHaveBeenLastCalledWith("/company/applications", { scroll: false });
  });

  it("counts the rows shown and pages", () => {
    const rows = Array.from({ length: 25 }, (_, i) => ({ ...USER_ROW, id: `row-${i}` }));
    renderTable({ rows, total: 1240, page: 2 });

    expect(screen.getByText("Showing 26–50 of 1,240 applications")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(push).toHaveBeenLastCalledWith("/company/applications?page=3", { scroll: false });
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(push).toHaveBeenLastCalledWith("/company/applications", { scroll: false });
  });

  it("disables Previous on the first page and Next on the last", () => {
    renderTable();
    expect(screen.getByText("Showing 1–3 of 3 applications")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("says when nothing matches", () => {
    renderTable({ rows: [], total: 0, params: { status: "rejected" } });
    expect(screen.getByText("No applications found.")).toBeInTheDocument();
  });
});
