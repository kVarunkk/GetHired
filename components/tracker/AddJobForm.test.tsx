import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import toast from "react-hot-toast";
import { addTrackedApplicationAction } from "@/app/actions/tracker/add-tracked-application";
import { readJobFromUrlAction } from "@/app/actions/tracker/read-job-from-url";
import AddJobForm from "./AddJobForm";

vi.mock("@/app/actions/tracker/add-tracked-application", () => ({ addTrackedApplicationAction: vi.fn() }));
vi.mock("@/app/actions/tracker/read-job-from-url", () => ({ readJobFromUrlAction: vi.fn() }));
vi.mock("react-hot-toast", () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/components/ui/responsive-select", () => import("@/test/utils/select-mock"));
vi.mock("@/components/agent/AgentHandoff", () => ({ default: () => <div>agent handoff</div> }));

const open = (props: Partial<Parameters<typeof AddJobForm>[0]> = {}) =>
  render(<AddJobForm defaultStatus="applied" resumes={[]} {...props} />);

const fill = (title: string, company: string) => {
  fireEvent.change(screen.getByLabelText("Job title"), { target: { value: title } });
  fireEvent.change(screen.getByLabelText("Company"), { target: { value: company } });
};
const readLink = (url: string) => {
  fireEvent.change(screen.getByLabelText("Link to the job (optional)"), { target: { value: url } });
  fireEvent.blur(screen.getByLabelText("Link to the job (optional)"));
};
const board = (overrides: Record<string, unknown> = {}) => ({
  ok: true,
  source: "board",
  job: {
    jobTitle: "Backend",
    companyName: "Globex",
    location: null,
    jobUrl: "https://gethired.devhub.co.in/jobs/j1",
    allJobsId: "j1",
    boardState: "open",
    applicationId: null,
    ...overrides,
  },
});

beforeEach(() => {
  vi.resetAllMocks();
});

describe("AddJobForm: the link (AT-REQ-036)", () => {
  it("shows the whole form at once, with the link as an optional first field", () => {
    open();
    expect(screen.getByText("agent handoff")).toBeTruthy();
    expect(screen.getByLabelText("Link to the job (optional)")).toBeTruthy();
    expect(screen.getByLabelText("Job title")).toBeTruthy();
    expect(screen.getByLabelText("Company")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Fill from link" })).toBeNull();
  });

  it("fills the form from a link that could be read", async () => {
    vi.mocked(readJobFromUrlAction).mockResolvedValue({
      ok: true,
      source: "json_ld",
      job: { jobTitle: "Designer", companyName: "Hooli", location: "Berlin", jobUrl: "https://jobs.lever.co/hooli/1", allJobsId: null, boardState: null, applicationId: null },
    } as never);
    open();
    readLink("https://jobs.lever.co/hooli/1");
    await waitFor(() => expect((screen.getByLabelText("Job title") as HTMLInputElement).value).toBe("Designer"));
    expect((screen.getByLabelText("Company") as HTMLInputElement).value).toBe("Hooli");
    expect((screen.getByLabelText("Location (optional)") as HTMLInputElement).value).toBe("Berlin");
  });

  it("keeps the link and shows the failure copy when the page cannot be read", async () => {
    vi.mocked(readJobFromUrlAction).mockResolvedValue({
      ok: false,
      reason: "unreadable",
      error: "We couldn't read that page. Fill in the details below.",
      jobUrl: "https://www.linkedin.com/jobs/view/1",
    } as never);
    open();
    readLink("https://www.linkedin.com/jobs/view/1");
    await screen.findByText("We couldn't read that page. Fill in the details below.");
    expect((screen.getByLabelText("Job title") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Link to the job (optional)") as HTMLInputElement).value).toBe("https://www.linkedin.com/jobs/view/1");
  });
});

describe("AddJobForm: reading the link when you leave the field", () => {
  it("reads a link once, and not again when the field is left again unchanged", async () => {
    vi.mocked(readJobFromUrlAction).mockResolvedValue(board() as never);
    open();
    readLink("https://gethired.devhub.co.in/jobs/j1");
    await screen.findByText(/This job is on GetHired/);
    fireEvent.blur(screen.getByLabelText("Link to the job (optional)"));
    expect(readJobFromUrlAction).toHaveBeenCalledTimes(1);
  });

  it("fills the description from the link and sends it with the job", async () => {
    vi.mocked(readJobFromUrlAction).mockResolvedValue({
      ok: true,
      source: "json_ld",
      job: { jobTitle: "Designer", companyName: "Hooli", location: null, description: "Design things.", jobUrl: "https://jobs.lever.co/hooli/1", allJobsId: null, boardState: null, applicationId: null },
    } as never);
    vi.mocked(addTrackedApplicationAction).mockResolvedValue({ ok: true, kind: "tracked", created: true, moved: false, id: "t1", status: "applied" } as never);
    open();
    readLink("https://jobs.lever.co/hooli/1");
    await waitFor(() => expect((screen.getByLabelText("Job description (optional)") as HTMLTextAreaElement).value).toBe("Design things."));
    await waitFor(() => expect((screen.getByRole("button", { name: "Add application" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Add application" }));
    await screen.findByRole("status");
    expect(addTrackedApplicationAction).toHaveBeenCalledWith(expect.objectContaining({ jobDescription: "Design things." }), "url");
  });

  it("does not read something that isn't an https link", () => {
    open();
    readLink("not a link");
    expect(readJobFromUrlAction).not.toHaveBeenCalled();
  });

  it("keeps a title and company the user typed instead of the page's", async () => {
    vi.mocked(readJobFromUrlAction).mockResolvedValue({
      ok: true,
      source: "meta",
      job: { jobTitle: "Page title", companyName: "Page co", location: null, jobUrl: "https://jobs.lever.co/x/1", allJobsId: null, boardState: null, applicationId: null },
    } as never);
    open();
    fill("My title", "My co");
    readLink("https://jobs.lever.co/x/1");
    await waitFor(() => expect(readJobFromUrlAction).toHaveBeenCalled());
    expect((screen.getByLabelText("Job title") as HTMLInputElement).value).toBe("My title");
  });
});

describe("AddJobForm: the form", () => {
  it("defaults the status to the tab and hides the applied date for Saved", () => {
    const { unmount } = open({ defaultStatus: "saved" });
    expect((screen.getByLabelText("Status") as HTMLSelectElement).value).toBe("saved");
    expect(screen.queryByLabelText("Applied on")).toBeNull();
    expect(screen.getByRole("button", { name: "Save job" })).toBeTruthy();
    unmount();
    open({ defaultStatus: "applied" });
    expect((screen.getByLabelText("Status") as HTMLSelectElement).value).toBe("applied");
    expect(screen.getByLabelText("Applied on")).toBeTruthy();
  });

  it("needs a title and a company, and offers the user's resumes", () => {
    open({ resumes: [{ id: "r1", name: "Main" }] });
    expect((screen.getByRole("button", { name: "Add application" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByLabelText("Resume used (optional)")).toBeTruthy();
  });

  it("adds a free-form job, with the link, and says where it went", async () => {
    vi.mocked(addTrackedApplicationAction).mockResolvedValue({ ok: true, kind: "tracked", created: true, moved: false, id: "t1", status: "applied" } as never);
    open();
    fireEvent.change(screen.getByLabelText("Link to the job (optional)"), { target: { value: "https://jobs.lever.co/hooli/1" } });
    fill("Designer", "Hooli");
    fireEvent.click(screen.getByRole("button", { name: "Add application" }));
    await screen.findByText("Added to Applications");
    expect(addTrackedApplicationAction).toHaveBeenCalledWith(
      expect.objectContaining({ jobTitle: "Designer", companyName: "Hooli", jobUrl: "https://jobs.lever.co/hooli/1", status: "applied" }),
      "manual",
    );
    expect(screen.getByRole("link", { name: "View" }).getAttribute("href")).toBe("/my-jobs/applications/t1");
  });

  it("links a GetHired job found from a link by its id, and doesn't let its title be edited", async () => {
    vi.mocked(readJobFromUrlAction).mockResolvedValue(board() as never);
    vi.mocked(addTrackedApplicationAction).mockResolvedValue({ ok: true, kind: "favorite", allJobsId: "j1" } as never);
    open({ defaultStatus: "saved" });
    readLink("https://gethired.devhub.co.in/jobs/j1");
    await screen.findByText(/This job is on GetHired/);
    expect(screen.queryByLabelText("Job title")).toBeNull();
    await waitFor(() => expect((screen.getByRole("button", { name: "Save job" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Save job" }));
    await screen.findByRole("status");
    expect(addTrackedApplicationAction).toHaveBeenCalledWith(expect.objectContaining({ allJobsId: "j1", status: "saved" }), "url");
  });

  it("goes back to a free-form job when the link changes", async () => {
    vi.mocked(readJobFromUrlAction).mockResolvedValue(board() as never);
    open();
    readLink("https://gethired.devhub.co.in/jobs/j1");
    await screen.findByText(/This job is on GetHired/);
    fireEvent.change(screen.getByLabelText("Link to the job (optional)"), { target: { value: "https://jobs.lever.co/other/1" } });
    expect(screen.getByLabelText("Job title")).toBeTruthy();
  });

  it("points an Easy Apply job to GetHired, and only lets it be saved", async () => {
    vi.mocked(readJobFromUrlAction).mockResolvedValue(board({ boardState: "easy_apply" }) as never);
    open();
    readLink("https://gethired.devhub.co.in/jobs/j1");
    await screen.findByText(/You apply to this one on GetHired/);
    expect(screen.getByRole("link", { name: "Open the job" }).getAttribute("href")).toBe("/jobs/j1");
    expect((screen.getByRole("button", { name: "Add application" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "saved" } });
    expect((screen.getByRole("button", { name: "Save job" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("links the application when the job was applied to through GetHired", async () => {
    vi.mocked(readJobFromUrlAction).mockResolvedValue(board({ boardState: "applied_on_gethired", applicationId: "app1" }) as never);
    open();
    readLink("https://gethired.devhub.co.in/jobs/j1");
    await screen.findByText(/You already applied through GetHired/);
    expect(screen.getByRole("link", { name: "View your application" }).getAttribute("href")).toBe("/my-jobs/applications/app1");
    expect((screen.getByRole("button", { name: "Add application" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("tells a saved card that moved to Applications", async () => {
    vi.mocked(addTrackedApplicationAction).mockResolvedValue({ ok: true, kind: "tracked", created: false, moved: true, id: "t1", status: "applied" } as never);
    open();
    fill("A", "B");
    fireEvent.click(screen.getByRole("button", { name: "Add application" }));
    await screen.findByText("Moved to Applications");
  });

  it("shows a refusal as a toast and stays on the form", async () => {
    vi.mocked(addTrackedApplicationAction).mockResolvedValue({ ok: false, reason: "platform_job", error: "Apply through GetHired." } as never);
    open();
    fill("A", "B");
    fireEvent.click(screen.getByRole("button", { name: "Add application" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Apply through GetHired."));
    expect(screen.getByLabelText("Job title")).toBeTruthy();
  });
});
