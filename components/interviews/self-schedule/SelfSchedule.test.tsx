import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useRouter } from "next/navigation";
import type { PublicLink } from "@/helpers/interviews/self-scheduling";
import SelfSchedule from "./SelfSchedule";

vi.mock("next/navigation", () => ({ useRouter: vi.fn() }));
vi.mock("@/components/ui/select", () => import("@/test/utils/select-mock"));
// A fixed zone for the assertions.
vi.mock("@/helpers/companies/time-zone", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/helpers/companies/time-zone")>()),
  browserTimeZone: () => "Europe/London",
}));

const TOKEN = "t".repeat(43);
const SLOTS = [
  { start: "2026-11-17T10:00:00.000Z", end: "2026-11-17T10:30:00.000Z" },
  { start: "2026-11-17T10:30:00.000Z", end: "2026-11-17T11:00:00.000Z" },
  { start: "2026-11-18T14:00:00.000Z", end: "2026-11-18T14:30:00.000Z" },
];

const link = (overrides: Partial<PublicLink> = {}): PublicLink => ({
  status: "awaiting_candidate",
  job_title: "Backend Engineer",
  company_name: "Acme",
  interview_name: "Intro call",
  duration_minutes: 30,
  interviewers: ["Rita", "Vera"],
  starts_at: null,
  ends_at: null,
  time_zone: null,
  meeting_url: null,
  can_change: false,
  expires_at: "2026-11-21T00:00:00.000Z",
  ...overrides,
});

const booked = (overrides: Partial<PublicLink> = {}) =>
  link({
    status: "scheduled",
    starts_at: "2026-11-17T10:00:00.000Z",
    ends_at: "2026-11-17T10:30:00.000Z",
    meeting_url: "https://meet.google.com/abc-defg-hij",
    can_change: true,
    ...overrides,
  });

const refresh = vi.fn();
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.mocked(useRouter).mockReturnValue({ refresh } as unknown as ReturnType<typeof useRouter>);
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const body = (i = 0) => JSON.parse(fetchMock.mock.calls[i][1].body as string);

describe("SelfSchedule (IVT-063)", () => {
  it("shows the job, company, interview, length and interviewers by name, and no address", () => {
    const { container } = render(<SelfSchedule token={TOKEN} link={link()} slots={SLOTS} />);
    expect(screen.getByRole("heading", { name: "Intro call" })).toBeInTheDocument();
    expect(screen.getByText("Acme · Backend Engineer")).toBeInTheDocument();
    expect(screen.getByText(/30 minutes/)).toHaveTextContent("with Rita and Vera");
    expect(container.textContent).not.toMatch(/@/);
  });

  it("lists the slots by day in the browser's zone", async () => {
    render(<SelfSchedule token={TOKEN} link={link()} slots={SLOTS} />);
    // London is UTC in November.
    await waitFor(() => expect(screen.getByLabelText("Time zone")).toHaveValue("Europe/London"));
    expect(screen.getByText("Tuesday 17 November")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "10:30" })).toBeInTheDocument();
  });

  it("changes the zone the times are shown in", async () => {
    render(<SelfSchedule token={TOKEN} link={link()} slots={SLOTS} />);
    fireEvent.change(screen.getByLabelText("Time zone"), { target: { value: "America/New_York" } });
    expect(await screen.findByRole("button", { name: "05:00" })).toBeInTheDocument();
  });

  it("books the picked time with the candidate's zone", async () => {
    render(<SelfSchedule token={TOKEN} link={link()} slots={SLOTS} />);
    await waitFor(() => expect(screen.getByLabelText("Time zone")).toHaveValue("Europe/London"));
    fireEvent.click(screen.getByRole("button", { name: "10:30" }));
    fireEvent.click(screen.getByRole("button", { name: "Book Tuesday 17 November, 10:30" }));
    expect(await screen.findByRole("status")).toHaveTextContent("You're booked");
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/schedule/${TOKEN}`);
    expect(body()).toEqual({ action: "book", startsAt: "2026-11-17T10:30:00.000Z", timeZone: "Europe/London" });
    expect(refresh).toHaveBeenCalled();
  });

  it("says when the time was just taken, and refreshes the list", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: false, reason: "slot_taken", error: "That time was just taken. Pick another one." }), {
        status: 409,
      }),
    );
    render(<SelfSchedule token={TOKEN} link={link()} slots={SLOTS} />);
    fireEvent.click(screen.getAllByRole("button", { name: /^\d\d:\d\d$/ })[0]);
    fireEvent.click(screen.getByRole("button", { name: /^Book / }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That time was just taken.");
    expect(refresh).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Pick a time" })).toBeDisabled();
  });

  it("shows the booked time and the call link, and moves it", async () => {
    render(<SelfSchedule token={TOKEN} link={booked()} slots={SLOTS.slice(1)} />);
    expect(screen.getByRole("link", { name: "Join the video call" })).toHaveAttribute(
      "href",
      "https://meet.google.com/abc-defg-hij",
    );
    fireEvent.click(screen.getByRole("button", { name: "Pick another time" }));
    fireEvent.click(screen.getAllByRole("button", { name: /^\d\d:\d\d$/ })[0]);
    fireEvent.click(screen.getByRole("button", { name: /^Move to / }));
    expect(await screen.findByRole("status")).toHaveTextContent("was moved");
    expect(body()).toEqual({ action: "reschedule", startsAt: "2026-11-17T10:30:00.000Z" });
  });

  it("asks before cancelling", async () => {
    render(<SelfSchedule token={TOKEN} link={booked()} slots={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel interview" }));
    expect(await screen.findByRole("status")).toHaveTextContent("was cancelled");
    expect(body()).toEqual({ action: "cancel" });
  });

  it("offers no changes inside the 4-hour cutoff", () => {
    render(<SelfSchedule token={TOKEN} link={booked({ can_change: false })} slots={[]} />);
    expect(screen.queryByRole("button", { name: "Pick another time" })).not.toBeInTheDocument();
    expect(screen.getByText(/less than 4 hours/)).toBeInTheDocument();
  });

  it("says when no times are open", () => {
    render(<SelfSchedule token={TOKEN} link={link()} slots={[]} />);
    expect(screen.getByText(/No times are open right now/)).toBeInTheDocument();
  });
});
