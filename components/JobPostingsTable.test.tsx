import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { IJobPost } from "@/utils/types";
import { COMPANY_A } from "@/test/utils/recruiter";
import { makeJobPost } from "@/test/utils/job-states";
import JobPostingsTable, { stateFilterFrom } from "./JobPostingsTable";

const replace = vi.fn();
let search = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace }),
  usePathname: () => "/company/job-posts",
  useSearchParams: () => new URLSearchParams(search),
}));
vi.mock("react-transition-progress/next", () => ({ Link: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/components/ui/select", () => import("@/test/utils/select-mock"));
vi.mock("./jobs/JobStateMenu", () => ({
  default: ({ job, viewer }: { job: IJobPost; viewer: { canPublish: boolean; canApprove: boolean } }) => (
    <span data-testid={`menu-${job.title}`}>
      {job.state} publish:{String(viewer.canPublish)} approve:{String(viewer.canApprove)}
    </span>
  ),
}));

const job = (title: string, state: IJobPost["state"], openings = 1) =>
  ({ ...makeJobPost(COMPANY_A, { state, openings }), title, applications: [{ count: 0 }] }) as IJobPost;

const JOBS = [
  job("Open job", "open", 3),
  job("Paused job", "paused"),
  job("Draft job", "draft"),
  job("Pending job", "pending_approval"),
  job("Closed job", "closed"),
  job("Filled job", "filled"),
];

beforeEach(() => {
  vi.clearAllMocks();
  search = "";
});

const titles = () =>
  ["Open job", "Paused job", "Draft job", "Pending job", "Closed job", "Filled job"].filter((t) => screen.queryByText(t));

describe("JobPostingsTable: the state filter (JLT-022, JL-REQ-029)", () => {
  it("shows open and paused jobs by default", () => {
    render(<JobPostingsTable data={JOBS} />);
    expect(titles()).toEqual(["Open job", "Paused job"]);
  });

  it.each([
    ["drafts", ["Draft job"]],
    ["pending", ["Pending job"]],
    ["archive", ["Closed job", "Filled job"]],
    ["all", ["Open job", "Paused job", "Draft job", "Pending job", "Closed job", "Filled job"]],
  ])("reads ?state=%s from the URL", (value, expected) => {
    search = `state=${value}`;
    render(<JobPostingsTable data={JOBS} />);
    expect(titles()).toEqual(expected);
  });

  it("writes the filter to the URL, dropping it for the default", () => {
    search = "state=drafts";
    render(<JobPostingsTable data={JOBS} />);
    const select = screen.getByLabelText("Filter by status");
    fireEvent.change(select, { target: { value: "archive" } });
    expect(replace).toHaveBeenLastCalledWith("/company/job-posts?state=archive", { scroll: false });
    fireEvent.change(select, { target: { value: "current" } });
    expect(replace).toHaveBeenLastCalledWith("/company/job-posts", { scroll: false });
  });

  it("falls back to the default for an unknown value", () => {
    expect(stateFilterFrom("nonsense")).toBe("current");
    expect(stateFilterFrom(null)).toBe("current");
  });
});

describe("JobPostingsTable: columns", () => {
  it("shows hires against openings", () => {
    render(<JobPostingsTable data={JOBS} hires={{ [JOBS[0].id]: 1 }} />);
    expect(screen.getByLabelText("Hired 1 of 3")).toHaveTextContent("1 / 3");
    expect(screen.getByLabelText("Hired 0 of 1")).toBeInTheDocument();
  });

  it("gives each row's state menu the viewer's permissions on that job (RP-REQ-016)", () => {
    render(<JobPostingsTable data={JOBS} publishable={[JOBS[0].id]} approvable={[]} />);
    expect(screen.getByTestId("menu-Open job")).toHaveTextContent("open publish:true approve:false");
    expect(screen.getByTestId("menu-Paused job")).toHaveTextContent("paused publish:false");
  });
});
