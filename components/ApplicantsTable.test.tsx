import { beforeEach, describe, expect, it, vi } from "vitest";
import { Children, isValidElement, type ReactNode } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import toast from "react-hot-toast";
import type { TApplicationServer } from "@/utils/types/application.types";
import ApplicantsTable from "./ApplicantsTable";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const handleEntitlement = vi.fn();
vi.mock("@/hooks/useEntitlementError", () => ({
  useEntitlementError: () => ({ handle: handleEntitlement, show: vi.fn(), dialog: <div data-testid="upgrade" /> }),
}));
vi.mock("react-hot-toast", () => ({ default: { error: vi.fn(), success: vi.fn() } }));

// Radix Select doesn't run in jsdom; a native <select> named by the trigger's
// aria-label keeps the same contract.
vi.mock("@/components/ui/select", () => {
  const SelectTrigger: (props: { "aria-label"?: string; className?: string; children?: ReactNode }) => null =
    () => null;
  return {
    Select: ({
      value,
      onValueChange,
      children,
    }: {
      value: string;
      onValueChange: (v: string) => void;
      children: ReactNode;
    }) => {
      const trigger = Children.toArray(children).find(
        (child) => isValidElement(child) && child.type === SelectTrigger,
      ) as { props: { "aria-label"?: string } } | undefined;
      return (
        <select
          aria-label={trigger?.props["aria-label"]}
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
        >
          {children}
        </select>
      );
    },
    SelectTrigger,
    SelectValue: () => null,
    SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
    SelectItem: ({ value, children }: { value: string; children: ReactNode }) => (
      <option value={value}>{children}</option>
    ),
  };
});

const JOB = { id: "b0000000-0000-4000-8000-000000000001", title: "Frontend Engineer" };
const OTHER_JOB = { id: "b0000000-0000-4000-8000-000000000002", title: "Designer" };
const fetchMock = vi.fn();

let seq = 0;
function applicationRow(
  name: string,
  screening: TApplicationServer["application_screenings"] = null,
  overrides: Partial<TApplicationServer> = {},
): TApplicationServer {
  seq += 1;
  return {
    id: `e0000000-0000-4000-8000-${seq.toString().padStart(12, "0")}`,
    created_at: `2026-10-${(10 + seq).toString().padStart(2, "0")}T00:00:00Z`,
    status: "submitted",
    resume_url: null,
    job_postings: JOB,
    user_info: { full_name: name },
    application_screenings: screening,
    ...overrides,
  };
}

const screened = (fit_score: number, recommendation: "strong_yes" | "yes" | "maybe" | "no") => ({
  status: "completed",
  fit_score,
  recommendation,
});

const names = () =>
  screen
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getAllByRole("cell")[0].textContent);

beforeEach(() => {
  vi.clearAllMocks();
  seq = 0;
  handleEntitlement.mockImplementation(async (res: Response) => res.status === 402);
  vi.stubGlobal("fetch", fetchMock);
});

describe("ApplicantsTable: behaviour that must survive", () => {
  const rows = () => [
    applicationRow("Grace"),
    applicationRow("Ada", null, { status: "reviewed", job_postings: OTHER_JOB }),
    applicationRow("Alan"),
  ];

  it("shows the existing columns", () => {
    const data = rows();
    render(<ApplicantsTable data={data} />);

    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual(
      expect.arrayContaining(["Applicant Name", "Job Title", "Status", "Date Applied", "Actions"]),
    );
    expect(names()).toEqual(["Grace", "Ada", "Alan"]);
    expect(screen.getAllByRole("link", { name: /View Applicant/ })[0]).toHaveAttribute(
      "href",
      `/company/applicants/${data[0].id}`,
    );
  });

  it("filters by name", async () => {
    render(<ApplicantsTable data={rows()} />);

    await userEvent.type(screen.getByPlaceholderText("Applicant Name"), "ad");

    expect(names()).toEqual(["Ada"]);
  });

  it("filters by job title and status", () => {
    render(<ApplicantsTable data={rows()} />);

    fireEvent.change(screen.getByRole("combobox", { name: "Filter by job title" }), {
      target: { value: "Designer" },
    });
    expect(names()).toEqual(["Ada"]);

    fireEvent.change(screen.getByRole("combobox", { name: "Filter by job title" }), {
      target: { value: "All Titles" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Filter by status" }), {
      target: { value: "submitted" },
    });
    expect(names()).toEqual(["Grace", "Alan"]);
  });

  it("sorts by name", async () => {
    render(<ApplicantsTable data={rows()} />);

    await userEvent.click(screen.getByRole("button", { name: /Applicant Name/ }));

    expect(names()).toEqual(["Ada", "Alan", "Grace"]);
  });
});

describe("ApplicantsTable: fit (MT-REQ-007, MT-TEST-006)", () => {
  const rows = () => [
    applicationRow("Unscreened"),
    applicationRow("Strong", screened(82, "yes")),
    applicationRow("Queued", { status: "queued", fit_score: null, recommendation: null }),
    applicationRow("Weak", screened(45, "no")),
    applicationRow("Top", screened(93, "strong_yes")),
  ];

  it("shows the score badge, Screening… or a dash", () => {
    render(<ApplicantsTable data={rows()} />);

    expect(screen.getByRole("columnheader", { name: /Fit/ })).toBeInTheDocument();
    expect(screen.getByText("82 · Strong")).toBeInTheDocument();
    expect(screen.getByText("Screening…")).toBeInTheDocument();
  });

  it("sorts by fit, highest first, with unscored rows last either way", async () => {
    render(<ApplicantsTable data={rows()} defaultSort="fit" />);

    expect(names()).toEqual(["Top", "Strong", "Weak", "Unscreened", "Queued"]);

    await userEvent.click(screen.getByRole("button", { name: /Fit/ }));

    expect(names().slice(0, 3)).toEqual(["Weak", "Strong", "Top"]);
    expect(names().slice(3)).toEqual(expect.arrayContaining(["Unscreened", "Queued"]));
  });

  it("filters by recommendation", () => {
    render(<ApplicantsTable data={rows()} />);

    fireEvent.change(screen.getByRole("combobox", { name: "Filter by recommendation" }), {
      target: { value: "strong_yes" },
    });

    expect(names()).toEqual(["Top"]);
  });

  it("shows Screen N unscreened in job context, counting none, stale, failed and skipped", () => {
    render(
      <ApplicantsTable
        jobPostId={JOB.id}
        data={[
          ...rows(),
          applicationRow("Stale", { status: "stale", fit_score: 70, recommendation: "maybe" }),
          applicationRow("Failed", { status: "failed", fit_score: null, recommendation: null }),
          applicationRow("Skipped", { status: "skipped_quota", fit_score: null, recommendation: null }),
        ]}
      />,
    );

    expect(screen.getByRole("button", { name: "Screen 4 unscreened" })).toBeInTheDocument();
  });

  it("hides the button when everything is screened, and outside job context", () => {
    const { unmount } = render(
      <ApplicantsTable jobPostId={JOB.id} data={[applicationRow("Strong", screened(82, "yes"))]} />,
    );
    expect(screen.queryByRole("button", { name: /unscreened/ })).not.toBeInTheDocument();
    unmount();

    render(<ApplicantsTable data={rows()} />);
    expect(screen.queryByRole("button", { name: /unscreened/ })).not.toBeInTheDocument();
  });

  it("queues the screenings and toasts the count", async () => {
    fetchMock.mockResolvedValue(Response.json({ queued: 1 }));
    render(<ApplicantsTable jobPostId={JOB.id} data={rows()} />);

    await userEvent.click(screen.getByRole("button", { name: "Screen 1 unscreened" }));

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/company/job-posts/${JOB.id}/screen`,
      expect.objectContaining({ method: "POST" }),
    );
    expect(toast.success).toHaveBeenCalledWith("Queued 1 screening.");
    expect(refresh).toHaveBeenCalled();
  });

  it("opens the upgrade dialog on a 402", async () => {
    fetchMock.mockResolvedValue(Response.json({ code: "entitlement" }, { status: 402 }));
    render(<ApplicantsTable jobPostId={JOB.id} data={rows()} />);

    await userEvent.click(screen.getByRole("button", { name: "Screen 1 unscreened" }));

    expect(handleEntitlement).toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });
});
