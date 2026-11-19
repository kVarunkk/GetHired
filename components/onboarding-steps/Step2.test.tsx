import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { IFormData } from "../OnboardingComponent";
import { Step2LocationSalary } from "./Step2";

vi.mock("@/components/ui/select", () => import("@/test/utils/select-mock"));
vi.mock("../LocationSearchSelect", () => ({ default: () => <div>locations</div> }));
vi.mock("../CurrencySelect", () => ({ default: () => <div>currency</div> }));

let form: IFormData;

function Harness({ initial }: { initial?: Partial<IFormData> }) {
  const [formData, setFormData] = useState({
    preferred_locations: [],
    salary_currency: "INR",
    salary_period: "year",
    min_salary: "",
    max_salary: "",
    ...initial,
  } as unknown as IFormData);
  form = formData;
  return (
    <Step2LocationSalary formData={formData} setFormData={setFormData} errors={{}} setErrors={() => {}} />
  );
}

describe("Step2LocationSalary salary", () => {
  it("shows what a yearly amount comes to per month and per hour", () => {
    render(<Harness initial={{ min_salary: 1_440_000 }} />);

    expect(screen.getByText("≈ ₹1,20,000 a month · ₹692.31 an hour")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("flags an amount that's low for a year and switches it to per month", () => {
    render(<Harness />);

    fireEvent.change(screen.getByLabelText("Minimum salary*"), { target: { value: "80000" } });
    expect(screen.getByRole("status")).toHaveTextContent(
      "₹80,000 is low for a year. If that's per month, it's ₹9,60,000 a year.",
    );

    fireEvent.click(screen.getByRole("button", { name: "It's per month" }));

    expect(form.salary_period).toBe("month");
    expect(form.min_salary).toBe(80_000);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByText("≈ ₹9,60,000 a year · ₹461.54 an hour")).toBeInTheDocument();
  });

  it("takes decimal hourly rates and says how the year is estimated", () => {
    render(<Harness initial={{ salary_currency: "USD", salary_period: "hour" }} />);

    fireEvent.change(screen.getByLabelText("Minimum salary*"), { target: { value: "25.5" } });

    expect(form.min_salary).toBe(25.5);
    expect(screen.getByText(/assuming 40 hours a week/)).toBeInTheDocument();
    expect(screen.getByText("≈ $53,040 a year · $4,420 a month")).toBeInTheDocument();
  });
});
