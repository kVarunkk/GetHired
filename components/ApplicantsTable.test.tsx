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
    application_knockouts: null,
    answers_v2: null,
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

  it("badges applications that failed a knockout rule, with the reasons (AF-REQ-003)", () => {
    render(
      <ApplicantsTable
        data={[
          applicationRow("Kai", null, {
            application_knockouts: { failed: true, reasons: [{ label: "Can you relocate?" }], action_taken: "flagged" },
          }),
          applicationRow("Lee", null, { application_knockouts: { failed: false, reasons: [], action_taken: "none" } }),
        ]}
      />,
    );

    expect(screen.getAllByTitle(/^Didn't meet: /)).toHaveLength(1);
    expect(screen.getByTitle("Didn't meet: Can you relocate?")).toHaveTextContent("Didn't meet requirements");
    expect(screen.getByRole("combobox", { name: "Filter by requirements" })).toBeInTheDocument();
  });

  it("filters by the answer to a yes/no or choice question (AF-REQ-008)", () => {
    const qid = "00000000-0000-4000-8000-000000000001";
    const names = () => screen.queryAllByRole("row").slice(1).map((r) => within(r).queryAllByRole("cell")[0]?.textContent);
    render(
      <ApplicantsTable
        data={[
          applicationRow("Yes Person", null, { answers_v2: { [qid]: true } }),
          applicationRow("No Person", null, { answers_v2: { [qid]: false } }),
          applicationRow("Old Person"),
        ]}
        answerQuestions={[{ id: qid, label: "Can you relocate?", options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }] }]}
      />,
    );

    expect(screen.queryByRole("combobox", { name: "Answer" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Filter by question" }), { target: { value: qid } });
    fireEvent.change(screen.getByRole("combobox", { name: "Answer" }), { target: { value: "yes" } });

    expect(names()).toEqual(["Yes Person"]);
    fireEvent.change(screen.getByRole("combobox", { name: "Answer" }), { target: { value: "no" } });
    expect(names()).toEqual(["No Person"]);
  });

  it("has no requirements filter when nothing failed", () => {
    render(<ApplicantsTable data={rows()} />);
    expect(screen.queryByRole("combobox", { name: "Filter by requirements" })).not.toBeInTheDocument();
  });

  it("shows the member's screenings left under their role's cap (RP-REQ-044)", () => {
    const { unmount } = render(
      <ApplicantsTable jobPostId={JOB.id} data={rows()} screeningCap={{ limit: 20, remaining: 5 }} />,
    );
    expect(screen.getByText("5 of your 20 screenings left this month")).toBeInTheDocument();
    unmount();

    render(<ApplicantsTable jobPostId={JOB.id} data={rows()} />);
    expect(screen.queryByText(/screenings left/)).not.toBeInTheDocument();
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

describe("ApplicantsTable: pipeline list (PLT-033)", () => {
  const STAGES = [
    { id: "5a000000-0000-4000-8000-000000000001", name: "Applied", kind: "applied" as const },
    { id: "5a000000-0000-4000-8000-000000000002", name: "Screening", kind: "screening" as const },
    { id: "5a000000-0000-4000-8000-000000000003", name: "Interview", kind: "interview" as const },
  ];
  const rows = () => [
    applicationRow("Grace", null, { stage_id: STAGES[0].id } as Partial<TApplicationServer>),
    applicationRow("Ada", null, { stage_id: STAGES[2].id } as Partial<TApplicationServer>),
    applicationRow("Alan", null, { stage_id: STAGES[0].id } as Partial<TApplicationServer>),
  ];
  const pipelineNames = () =>
    screen
      .getAllByRole("row")
      .slice(1)
      .map((row) => within(row).getAllByRole("cell")[1].textContent);

  it("shows a Stage column with each application's stage", () => {
    render(<ApplicantsTable data={rows()} stages={STAGES} />);

    expect(screen.getByRole("columnheader", { name: /Stage/ })).toBeInTheDocument();
    const ada = screen.getAllByRole("row").find((r) => r.textContent?.includes("Ada"))!;
    expect(within(ada).getByText("Interview")).toBeInTheDocument();
  });

  it("filters by stage", () => {
    render(<ApplicantsTable data={rows()} stages={STAGES} />);

    fireEvent.change(screen.getByRole("combobox", { name: "Filter by stage" }), {
      target: { value: STAGES[0].id },
    });

    expect(pipelineNames()).toEqual(["Grace", "Alan"]);
  });

  it("selects rows one by one and all at once", async () => {
    const data = rows();
    const onRowSelectionChange = vi.fn();
    render(
      <ApplicantsTable
        data={data}
        stages={STAGES}
        rowSelection={{}}
        onRowSelectionChange={onRowSelectionChange}
      />,
    );

    await userEvent.click(screen.getByRole("checkbox", { name: "Select Ada" }));
    expect(onRowSelectionChange).toHaveBeenLastCalledWith({ [data[1].id]: true });

    await userEvent.click(screen.getByRole("checkbox", { name: "Select all" }));
    expect(onRowSelectionChange).toHaveBeenLastCalledWith(
      Object.fromEntries(data.map((d) => [d.id, true])),
    );
  });

  it("has no selection or stage column outside the pipeline", () => {
    render(<ApplicantsTable data={rows()} />);

    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Filter by stage" })).not.toBeInTheDocument();
  });
});
