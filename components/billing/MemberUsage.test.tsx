import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { MemberUsageRow } from "@/helpers/billing/member-usage";
import MemberUsage from "./MemberUsage";

const ROWS: MemberUsageRow[] = [
  { userId: "u1", name: "Olive", isOwner: true, roleName: null, usage: { outreach: 3 }, limits: {} },
  { userId: "u2", name: "Rita", isOwner: false, roleName: "Recruiter", usage: { outreach: 50, screenings: 2 }, limits: { outreach: 50 } },
  { userId: "u3", name: "Ian", isOwner: false, roleName: "Interviewer", usage: {}, limits: {} },
];

describe("MemberUsage (RP-REQ-044)", () => {
  it("lists each member with their role and usage against their caps", () => {
    render(<MemberUsage rows={ROWS} />);
    expect(screen.getByText("Owner")).toBeInTheDocument();
    expect(screen.getByText("Recruiter")).toBeInTheDocument();
    expect(screen.getByTestId("member-usage-u1-outreach")).toHaveTextContent(/^3$/);
    expect(screen.getByTestId("member-usage-u2-outreach")).toHaveTextContent("50 of 50");
    expect(screen.getByTestId("member-usage-u2-outreach")).toHaveClass("text-destructive");
    expect(screen.getByTestId("member-usage-u2-screenings")).toHaveTextContent(/^2$/);
    expect(screen.getByRole("columnheader", { name: "outreach messages" })).toBeInTheDocument();
    // Ian used nothing but still gets a cell per column.
    expect(screen.getByTestId("member-usage-u3-outreach")).toHaveTextContent(/^0$/);
  });

  it("says when a member has used nothing", () => {
    render(<MemberUsage rows={[ROWS[2]]} />);
    expect(screen.getByText("No usage yet")).toBeInTheDocument();
  });

  it("shows a cap even before anything is used", () => {
    render(<MemberUsage rows={[{ ...ROWS[2], limits: { screenings: 10 } }]} />);
    expect(screen.getByTestId("member-usage-u3-screenings")).toHaveTextContent("0 of 10");
  });
});
