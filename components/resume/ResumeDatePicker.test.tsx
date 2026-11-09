import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { isResumeDateBefore, readResumeDate } from "@/helpers/resume/resume-dates";
import ResumeDatePicker from "./ResumeDatePicker";

vi.mock("@/components/ui/select", () => import("@/test/utils/select-mock"));

const show = (
  value: string | undefined,
  props: { allowPresent?: boolean; notBefore?: string; notAfter?: string } = {},
) => {
  const onChange = vi.fn();
  render(<ResumeDatePicker id="start" value={value} onChange={onChange} {...props} />);
  fireEvent.click(screen.getByRole("button", { name: value || "Select date" }));
  return onChange;
};

describe("readResumeDate", () => {
  it.each([
    ["Jan 2020", { year: 2020, month: 0 }],
    ["September 2021", { year: 2021, month: 8 }],
    ["Sept 2021", { year: 2021, month: 8 }],
    ["03/2021", { year: 2021, month: 2 }],
    ["2021-03", { year: 2021, month: 2 }],
    ["2019", { year: 2019, month: undefined }],
    ["Summer 2019", { year: 2019, month: undefined }],
    ["Present", { year: undefined, month: undefined }],
    ["13/2021", { year: 2021, month: undefined }],
  ])("reads %s", (value, expected) => {
    expect(readResumeDate(value)).toEqual(expected);
  });
});

describe("isResumeDateBefore", () => {
  it.each([
    ["Jan 2020", "Feb 2020", true],
    ["Dec 2019", "Jan 2020", true],
    ["Feb 2020", "Jan 2020", false],
    ["Jan 2020", "Jan 2020", false],
    ["2019", "Mar 2020", true],
    ["2020", "Mar 2020", false],
    ["Mar 2020", "2020", false],
    ["Present", "Jan 2020", false],
    ["Jan 2020", "Present", false],
    [undefined, "Jan 2020", false],
  ])("%s before %s: %s", (a, b, expected) => {
    expect(isResumeDateBefore(a, b)).toBe(expected);
  });
});

describe("ResumeDatePicker", () => {
  it("won't pick an end before the start", () => {
    show(undefined, { notBefore: "Mar 2021" });

    const years = Array.from((screen.getByLabelText("Year") as HTMLSelectElement).options, (option) => option.value);
    expect(years).not.toContain("2020");
    expect(years).toContain("2021");

    fireEvent.change(screen.getByLabelText("Year"), { target: { value: "2021" } });
    expect(screen.getByRole("button", { name: "Feb" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Mar" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Year only" })).toBeEnabled();
  });

  it("won't pick a start after the end", () => {
    show(undefined, { notAfter: "Mar 2021" });

    expect(screen.getByLabelText("Year")).toHaveValue("2021");
    expect(screen.getByRole("button", { name: "Mar" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Apr" })).toBeDisabled();
  });

  it("isn't limited by an end of Present", () => {
    show(undefined, { notAfter: "Present" });

    fireEvent.change(screen.getByLabelText("Year"), { target: { value: "2021" } });
    expect(screen.getByRole("button", { name: "Dec" })).toBeEnabled();
  });

  it("shows a date as written", () => {
    render(<ResumeDatePicker id="start" value="Summer 2019" onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Summer 2019" })).toBeInTheDocument();
  });

  it("opens on the stored date, and picks a month in the chosen year", () => {
    const onChange = show("Mar 2021");

    expect(screen.getByLabelText("Year")).toHaveValue("2021");
    expect(screen.getByRole("button", { name: "Mar" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.change(screen.getByLabelText("Year"), { target: { value: "2018" } });
    expect(screen.getByRole("button", { name: "Mar" })).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(screen.getByRole("button", { name: "Jun" }));
    expect(onChange).toHaveBeenCalledWith("Jun 2018");
  });

  it("can keep just the year", () => {
    const onChange = show("Mar 2021");
    fireEvent.click(screen.getByRole("button", { name: "Year only" }));
    expect(onChange).toHaveBeenCalledWith("2021");
  });

  it("offers Present only for an end date", () => {
    const onChange = show(undefined, { allowPresent: true });
    fireEvent.click(screen.getByRole("button", { name: "Present" }));
    expect(onChange).toHaveBeenCalledWith("Present");
  });

  it("has no Present for a start date", () => {
    show(undefined);
    expect(screen.queryByRole("button", { name: "Present" })).not.toBeInTheDocument();
  });

  it("clears a date", () => {
    const onChange = show("2019");
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(onChange).toHaveBeenCalledWith("");
  });
});
