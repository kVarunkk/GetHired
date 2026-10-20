import { beforeEach, describe, expect, it, vi } from "vitest";
import { Children, isValidElement, type ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CompanyOutreachItem } from "@/helpers/outreach/list";
import OutreachTable from "./OutreachTable";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }), usePathname: () => "/company/outreach" }));
vi.mock("@/components/outreach/WithdrawOutreachButton", () => ({ default: () => <button>Withdraw</button> }));

// Radix Select doesn't run in jsdom; a native <select> named by the trigger's
// aria-label keeps the same contract.
vi.mock("@/components/ui/select", () => {
  const SelectTrigger: (props: { "aria-label"?: string; className?: string; children?: ReactNode }) => null =
    () => null;
  return {
    Select: ({
      value,
      disabled,
      onValueChange,
      children,
    }: {
      value: string;
      disabled?: boolean;
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
          disabled={disabled}
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

const itemOf = (id: string, name: string, overrides: Partial<CompanyOutreachItem> = {}): CompanyOutreachItem => ({
  id,
  candidateUserId: `user-${id}`,
  candidateName: name,
  jobPostId: JOB.id,
  jobTitle: JOB.title,
  subject: `Hello ${name}`,
  status: "sent",
  source: "manual",
  senderName: "Olive Owner",
  sentAt: "2026-10-01T09:00:00.000Z",
  respondedAt: null,
  expiresAt: "2026-10-31T09:00:00.000Z",
  ...overrides,
});

const ITEMS = [
  itemOf("1", "Ada Lovelace"),
  itemOf("2", "Grace Hopper", { status: "interested", respondedAt: "2026-10-02T00:00:00.000Z" }),
];

const renderTable = (props: Partial<Parameters<typeof OutreachTable>[0]> = {}) =>
  render(
    <OutreachTable items={ITEMS} jobs={[JOB]} jobPostId={null} status={null} cursor={null} nextCursor={null} {...props} />,
  );

beforeEach(() => {
  vi.clearAllMocks();
});

describe("OutreachTable", () => {
  it("lists candidates with status, and Withdraw only for open ones", () => {
    renderTable();
    expect(screen.getByRole("link", { name: "Ada Lovelace" })).toHaveAttribute("href", "/company/profiles/user-1");
    expect(screen.getByText("Hello Ada Lovelace")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Withdraw" })).toHaveLength(1);
    expect(screen.getByText("Showing 2 messages")).toBeInTheDocument();
  });

  it("links each message to its page", () => {
    renderTable();

    expect(screen.getByRole("link", { name: "Hello Ada Lovelace" })).toHaveAttribute("href", "/company/outreach/1");
    expect(screen.getAllByRole("link", { name: "View" }).map((link) => link.getAttribute("href"))).toEqual([
      "/company/outreach/1",
      "/company/outreach/2",
    ]);
  });

  it("shows who sent each message (TMT-062)", () => {
    renderTable();

    expect(screen.getAllByText("by Olive Owner")).toHaveLength(2);
    expect(screen.getAllByText("OO").length).toBeGreaterThan(0);
  });

  it("searches candidates on the loaded page", async () => {
    const user = userEvent.setup();
    renderTable();
    await user.type(screen.getByLabelText("Filter by candidate"), "grace");
    expect(screen.queryByText("Ada Lovelace")).not.toBeInTheDocument();
    expect(screen.getByText("Grace Hopper")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("puts the job and status filters in the URL, dropping the cursor", () => {
    renderTable({ status: "sent", cursor: "c1" });
    fireEvent.change(screen.getByRole("combobox", { name: "Filter by job" }), { target: { value: JOB.id } });
    expect(push).toHaveBeenLastCalledWith(`/company/outreach?job=${JOB.id}&status=sent`);

    fireEvent.change(screen.getByRole("combobox", { name: "Filter by status" }), {
      target: { value: "All Statuses" },
    });
    expect(push).toHaveBeenLastCalledWith("/company/outreach");
  });

  it("clears every filter", async () => {
    const user = userEvent.setup();
    renderTable({ jobPostId: JOB.id, status: "sent" });
    await user.click(screen.getByRole("button", { name: /Clear Filters/ }));
    expect(push).toHaveBeenCalledWith("/company/outreach");
  });

  it("pages with the cursor", async () => {
    const user = userEvent.setup();
    renderTable({ status: "sent", cursor: "c1", nextCursor: "c2" });
    await user.click(screen.getByRole("button", { name: "Older" }));
    expect(push).toHaveBeenLastCalledWith("/company/outreach?status=sent&cursor=c2");
    await user.click(screen.getByRole("button", { name: "Newest" }));
    expect(push).toHaveBeenLastCalledWith("/company/outreach?status=sent");
  });

  it("shows the empty state, or no matches when filtered", () => {
    const { unmount } = renderTable({ items: [] });
    expect(screen.getByText(/No outreach yet\. Outreach starts from a candidate's profile/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Profiles" })).toHaveAttribute("href", "/company/profiles");
    expect(screen.getByRole("button", { name: "Older" })).toBeDisabled();
    unmount();

    renderTable({ items: [], status: "reported" });
    expect(screen.getByText("No outreach found.")).toBeInTheDocument();
  });
});
