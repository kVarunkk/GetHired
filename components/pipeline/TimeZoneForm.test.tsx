import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@/components/ui/select", () => import("@/test/utils/select-mock"));
vi.mock("react-hot-toast", () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/app/actions/company/save-company-time-zone", () => ({ saveCompanyTimeZoneAction: vi.fn() }));

import toast from "react-hot-toast";
import { saveCompanyTimeZoneAction } from "@/app/actions/company/save-company-time-zone";
import TimeZoneForm from "./TimeZoneForm";

beforeEach(() => vi.clearAllMocks());

describe("TimeZoneForm (IVT-024)", () => {
  it("saves the picked zone", async () => {
    vi.mocked(saveCompanyTimeZoneAction).mockResolvedValue({ ok: true });
    render(<TimeZoneForm initial="Europe/London" />);
    const save = screen.getByRole("button", { name: "Save time zone" });
    expect(save).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Time zone"), { target: { value: "Europe/Paris" } });
    fireEvent.click(save);

    await waitFor(() => expect(saveCompanyTimeZoneAction).toHaveBeenCalledWith({ timeZone: "Europe/Paris" }));
    expect(toast.success).toHaveBeenCalledWith("Time zone saved.");
  });

  it("offers the browser's zone when none is saved", () => {
    render(<TimeZoneForm initial={null} />);
    expect(screen.getByLabelText("Time zone")).toHaveValue(Intl.DateTimeFormat().resolvedOptions().timeZone);
    expect(screen.getByRole("button", { name: "Save time zone" })).toBeEnabled();
  });

  it("shows the action's refusal", async () => {
    vi.mocked(saveCompanyTimeZoneAction).mockResolvedValue({ ok: false, error: "Pick a time zone from the list." });
    render(<TimeZoneForm initial={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Save time zone" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Pick a time zone from the list."));
  });
});
