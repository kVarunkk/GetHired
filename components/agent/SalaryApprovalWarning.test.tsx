import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SalaryApprovalWarning } from "./SalaryApprovalWarning";

let profileCurrency: string | null = "INR";
const swrKeys: unknown[] = [];
vi.mock("swr", () => ({
  default: (key: unknown) => {
    swrKeys.push(key);
    return { data: key ? { profile: { salary_currency: profileCurrency } } : undefined };
  },
}));

beforeEach(() => {
  profileCurrency = "INR";
  swrKeys.length = 0;
});

describe("SalaryApprovalWarning", () => {
  it("warns when a yearly amount looks like a month's pay", () => {
    render(<SalaryApprovalWarning input={{ salaryCurrency: "INR", minSalary: 50_000, maxSalary: 1_500_000 }} />);

    expect(screen.getByRole("status")).toHaveTextContent(
      "A minimum of ₹50,000 is low for a year. If that's per month, it's ₹6,00,000 a year.",
    );
    expect(screen.getByRole("status")).not.toHaveTextContent("maximum");
    expect(screen.getByText(/decline and tell the assistant the yearly amount/)).toBeInTheDocument();
    // The currency came with the call, so the profile isn't loaded.
    expect(swrKeys.every((key) => key === null)).toBe(true);
  });

  it("only says it's low when twelve times it is still too low", () => {
    render(<SalaryApprovalWarning input={{ salaryCurrency: "JPY", minSalary: 50_000 }} />);

    expect(screen.getByRole("status")).toHaveTextContent("A minimum of ¥50,000 is low for a year.");
    expect(screen.getByRole("status")).not.toHaveTextContent("per month");
  });

  it("uses the profile's currency when the call changes only the amount", () => {
    profileCurrency = "USD";
    render(<SalaryApprovalWarning input={{ maxSalary: 6_000 }} />);

    expect(swrKeys).toContain("/api/current-user");
    expect(screen.getByRole("status")).toHaveTextContent(
      "A maximum of $6,000 is low for a year. If that's per month, it's $72,000 a year.",
    );
  });

  it("shows nothing for plausible amounts, calls without a salary or an unknown currency", () => {
    const { container, rerender } = render(
      <SalaryApprovalWarning input={{ salaryCurrency: "INR", minSalary: 1_200_000 }} />,
    );
    expect(container).toBeEmptyDOMElement();

    rerender(<SalaryApprovalWarning input={{ desiredRoles: ["Backend Engineer"] }} />);
    expect(container).toBeEmptyDOMElement();

    profileCurrency = null;
    rerender(<SalaryApprovalWarning input={{ minSalary: 50 }} />);
    expect(container).toBeEmptyDOMElement();
  });
});
