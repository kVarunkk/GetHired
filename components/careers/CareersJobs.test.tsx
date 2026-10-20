import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { parseCareersFilters, type CareersJobView, type CareersSearchView } from "@/helpers/careers/search-company-jobs";
import CareersJobs from "./CareersJobs";

vi.mock("@/components/ui/select", () => import("@/test/utils/select-mock"));

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }), usePathname: () => "/careers/acme" }));

const view = (n: number, overrides: Partial<CareersJobView> = {}): CareersJobView => ({
  id: `b${n}`,
  allJobsId: `d${n}`,
  title: `Role ${n}`,
  snippet: "",
  locations: ["bengaluru"],
  jobType: "Fulltime",
  department: null,
  workplaceType: null,
  salaryCurrency: null,
  salaryRange: null,
  minSalary: null,
  maxSalary: null,
  minExperience: null,
  maxExperience: null,
  experience: null,
  createdAt: "2026-10-01",
  ...overrides,
});

const INITIAL: CareersSearchView = {
  jobs: [view(1, { workplaceType: "remote" })],
  total: 2,
  page: 1,
  hasMore: true,
  departments: [{ name: "Other", count: 2 }],
  options: { locations: ["bengaluru"], jobTypes: ["Fulltime"], departments: [], workplaces: ["remote"] },
};

const fetchMock = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
});

const renderJobs = (query = "") =>
  render(
    <CareersJobs slug="acme" initial={INITIAL} filters={parseCareersFilters(new URLSearchParams(query))} jobBasePath="/careers/acme/jobs" />,
  );

describe("CareersJobs (CP-REQ-005)", () => {
  it("puts a changed filter in the URL, back on page 1", () => {
    renderJobs("q=go&page=3");
    fireEvent.change(screen.getByLabelText("Workplace"), { target: { value: "remote" } });
    expect(replace).toHaveBeenCalledWith("/careers/acme?q=go&workplace=remote", { scroll: false });
  });

  it("searches on submit", () => {
    renderJobs();
    fireEvent.change(screen.getByLabelText("Search roles"), { target: { value: " backend " } });
    fireEvent.submit(screen.getByRole("search"));
    expect(replace).toHaveBeenCalledWith("/careers/acme?q=backend", { scroll: false });
  });

  it("hides filters with nothing to pick", () => {
    renderJobs();
    expect(screen.queryByLabelText("Department")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Location")).toBeInTheDocument();
  });

  it("loads the next page from the API and appends it", async () => {
    fetchMock.mockResolvedValue(
      Response.json({ ...INITIAL, jobs: [view(2, { title: "Second role" })], page: 2, hasMore: false }),
    );
    renderJobs("workplace=remote");

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));

    expect(await screen.findByRole("link", { name: /Second role/ })).toHaveAttribute("href", "/careers/acme/jobs/d2");
    expect(fetchMock).toHaveBeenCalledWith("/api/careers/acme/jobs?workplace=remote&page=2");
    await waitFor(() => expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument());
    expect(screen.getByRole("link", { name: /Role 1/ })).toBeInTheDocument();
  });

  it("shows an empty state", () => {
    render(
      <CareersJobs
        slug="acme"
        initial={{ ...INITIAL, jobs: [], total: 0, hasMore: false, departments: [] }}
        filters={parseCareersFilters(new URLSearchParams())}
        jobBasePath="/careers/acme/jobs"
      />,
    );
    expect(screen.getByText("No open roles match")).toBeInTheDocument();
  });
});
