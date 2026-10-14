import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import toast from "react-hot-toast";
import { createClient } from "@/lib/supabase/client";
import { updateApplicationStatusAction } from "@/app/actions/update-application-status";
import { TApplicationStatus } from "@/utils/types";
import type { TApplication1 } from "@/utils/types/jobs.types";
import ApplicationStatusSelect from "./ApplicationStatusSelector";

vi.mock("@/app/actions/update-application-status", () => ({
  updateApplicationStatusAction: vi.fn(),
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn() }));
vi.mock("react-hot-toast", () => ({ default: { success: vi.fn(), error: vi.fn() } }));

// Radix Select doesn't run in jsdom; a native <select> keeps the same contract.
vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    disabled,
    children,
  }: {
    value: string;
    onValueChange: (v: string) => void;
    disabled?: boolean;
    children: ReactNode;
  }) => (
    <select
      aria-label="Application status"
      value={value}
      disabled={disabled}
      onChange={(e) => onValueChange(e.target.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));

const APPLICATION = {
  id: "e0000000-0000-4000-8000-000000000001",
  status: "submitted",
} as TApplication1;

const select = () => screen.getByRole("combobox", { name: "Application status" });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ApplicationStatusSelect (RS-TEST-003)", () => {
  it("saves through the server action, not the browser client", async () => {
    vi.mocked(updateApplicationStatusAction).mockResolvedValue({ ok: true, status: TApplicationStatus.REVIEWED });
    render(<ApplicationStatusSelect application={APPLICATION} />);

    fireEvent.change(select(), { target: { value: "reviewed" } });

    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    expect(updateApplicationStatusAction).toHaveBeenCalledWith({
      applicationId: APPLICATION.id,
      status: "reviewed",
    });
    expect(createClient).not.toHaveBeenCalled();
    expect(select()).toHaveValue("reviewed");
  });

  it("shows the new status optimistically and disables the select while saving", async () => {
    const pending = deferred<{ ok: true; status: TApplicationStatus }>();
    vi.mocked(updateApplicationStatusAction).mockReturnValue(pending.promise);
    render(<ApplicationStatusSelect application={APPLICATION} />);

    fireEvent.change(select(), { target: { value: "selected" } });

    expect(select()).toHaveValue("selected");
    expect(select()).toBeDisabled();

    pending.resolve({ ok: true, status: TApplicationStatus.SELECTED });
    await waitFor(() => expect(select()).toBeEnabled());
  });

  it("rolls back and shows an error when the action refuses", async () => {
    vi.mocked(updateApplicationStatusAction).mockResolvedValue({ ok: false, error: "Application not found." });
    render(<ApplicationStatusSelect application={APPLICATION} />);

    fireEvent.change(select(), { target: { value: "rejected" } });

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Application not found."));
    expect(select()).toHaveValue("submitted");
    expect(select()).toBeEnabled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("rolls back and shows an error when the request fails", async () => {
    vi.mocked(updateApplicationStatusAction).mockRejectedValue(new Error("network"));
    render(<ApplicationStatusSelect application={APPLICATION} />);

    fireEvent.change(select(), { target: { value: "rejected" } });

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(select()).toHaveValue("submitted");
  });
});
