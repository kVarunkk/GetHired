import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("@/components/ui/select", () => import("@/test/utils/select-mock"));
vi.mock("react-hot-toast", () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/actions/calendar/save-availability", () => ({ saveMyAvailabilityAction: vi.fn() }));
vi.mock("@/app/actions/calendar/disconnect", () => ({ disconnectCalendarAction: vi.fn() }));

import toast from "react-hot-toast";
import { saveMyAvailabilityAction } from "@/app/actions/calendar/save-availability";
import { disconnectCalendarAction } from "@/app/actions/calendar/disconnect";
import MyCalendarSettings from "./MyCalendarSettings";

const CONNECT = "/api/calendar/google/connect?returnTo=%2Fcompany%2Fsettings%2Fmy-calendar";

const connected = { accountEmail: "rita@gmail.test", status: "active" as const, connectedAt: "2026-11-10T10:00:00.000Z" };

beforeEach(() => vi.clearAllMocks());

describe("MyCalendarSettings: the connection (IVT-037)", () => {
  it("offers to connect when there's no connection", () => {
    render(<MyCalendarSettings connection={null} availability={null} companyZone={null} />);
    expect(screen.getByText(/isn't connected/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Connect Google Calendar" })).toHaveAttribute("href", CONNECT);
  });

  it("shows the account and disconnects after a confirm", async () => {
    vi.mocked(disconnectCalendarAction).mockResolvedValue({ ok: true });
    render(<MyCalendarSettings connection={connected} availability={null} companyZone={null} />);
    expect(screen.getByText("rita@gmail.test")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Connect Google Calendar" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Disconnect" }));
    await waitFor(() => expect(disconnectCalendarAction).toHaveBeenCalled());
    expect(toast.success).toHaveBeenCalledWith("Google Calendar disconnected.");
  });

  it("asks to reconnect when the connection is in error", () => {
    render(<MyCalendarSettings connection={{ ...connected, status: "error" }} availability={null} companyZone={null} />);
    expect(screen.getByText(/can no longer reach your Google Calendar/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Reconnect" })).toHaveAttribute("href", CONNECT);
  });

  it("shows the outcome of a connect attempt", () => {
    const { rerender } = render(
      <MyCalendarSettings connection={connected} availability={null} companyZone={null} notice={{ connected: true }} />,
    );
    expect(screen.getByText("Google Calendar connected.")).toBeInTheDocument();
    rerender(<MyCalendarSettings connection={null} availability={null} companyZone={null} notice={{ error: "scopes" }} />);
    expect(screen.getByText(/needs both permissions/)).toBeInTheDocument();
  });
});

describe("MyCalendarSettings: working hours (IVT-037, IV-REQ-011)", () => {
  it("defaults to Mon–Fri 10:00–18:00 in the browser's zone", () => {
    render(<MyCalendarSettings connection={null} availability={null} companyZone="Asia/Kolkata" />);
    expect(screen.getByLabelText("Time zone")).toHaveValue(Intl.DateTimeFormat().resolvedOptions().timeZone);
    expect(screen.getByRole("switch", { name: "Monday" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "Saturday" })).not.toBeChecked();
    expect(screen.getByLabelText("Monday start")).toHaveValue("10:00");
    expect(screen.getByLabelText("Monday end")).toHaveValue("18:00");
    expect(screen.queryByLabelText("Saturday start")).toBeNull();
  });

  it("saves the edited hours", async () => {
    vi.mocked(saveMyAvailabilityAction).mockResolvedValue({ ok: true });
    render(
      <MyCalendarSettings
        connection={null}
        availability={{ time_zone: "Europe/London", working_hours: { mon: { start: "09:00", end: "17:00" } } }}
        companyZone={null}
      />,
    );
    fireEvent.click(screen.getByRole("switch", { name: "Tuesday" }));
    fireEvent.change(screen.getByLabelText("Tuesday end"), { target: { value: "12:30" } });
    fireEvent.click(screen.getByRole("button", { name: "Save working hours" }));

    await waitFor(() =>
      expect(saveMyAvailabilityAction).toHaveBeenCalledWith({
        timeZone: "Europe/London",
        workingHours: { mon: { start: "09:00", end: "17:00" }, tue: { start: "10:00", end: "12:30" } },
      }),
    );
    expect(toast.success).toHaveBeenCalledWith("Working hours saved.");
  });

  it("shows the schema's message and doesn't save an end before the start", () => {
    render(<MyCalendarSettings connection={null} availability={null} companyZone={null} />);
    fireEvent.change(screen.getByLabelText("Monday end"), { target: { value: "09:00" } });
    expect(screen.getByText("End after the start.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save working hours" })).toBeDisabled();
  });
});
