import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import CurrencySelect from "./CurrencySelect";

// Radix's popover and cmdk measure themselves; jsdom has none of these.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

beforeEach(() => {
  Element.prototype.scrollIntoView ??= vi.fn();
  Element.prototype.hasPointerCapture ??= vi.fn(() => false);
});

describe("CurrencySelect", () => {
  it("shows the code and name, reading an old symbol as its code", () => {
    render(<CurrencySelect value="₹" onChange={() => {}} />);

    expect(screen.getByRole("combobox", { name: "Currency" })).toHaveTextContent("INR · Indian Rupee");
  });

  it("lists every currency, common ones first, and picks a code", async () => {
    const onChange = vi.fn();
    render(<CurrencySelect value="USD" onChange={onChange} />);

    fireEvent.click(screen.getByRole("combobox", { name: "Currency" }));
    const options = await screen.findAllByRole("option");
    expect(options.length).toBeGreaterThan(100);
    expect(options[0]).toHaveTextContent("INR");

    fireEvent.click(screen.getByRole("option", { name: /Brazilian Real/ }));
    expect(onChange).toHaveBeenCalledWith("BRL");
  });

  it("offers no currency when the filter allows any", async () => {
    const onChange = vi.fn();
    render(<CurrencySelect value="EUR" onChange={onChange} anyLabel="Any currency" aria-label="Salary Currency" />);

    fireEvent.click(screen.getByRole("combobox", { name: "Salary Currency" }));
    fireEvent.click(await screen.findByRole("option", { name: "Any currency" }));
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("shows the placeholder without a value", () => {
    render(<CurrencySelect value="" onChange={() => {}} anyLabel="Any currency" />);

    expect(screen.getByRole("combobox")).toHaveTextContent("Any currency");
  });
});
