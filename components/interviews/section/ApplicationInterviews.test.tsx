import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ApplicationInterview, InterviewStageGroup, PanelSeat } from "@/helpers/interviews/interviews";
import ApplicationInterviews from "./ApplicationInterviews";
import { RecordInterviewForm } from "./RecordInterviewForm";
import { calendarBanner, canMarkNoShow, canRemind, localInputToIso } from "./interview-view";

vi.mock("@/components/ui/select", () => import("@/test/utils/select-mock"));
vi.mock("react-hot-toast", () => ({ default: { success: vi.fn(), error: vi.fn() } }));
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push }) }));
vi.mock("@/app/actions/interviews/cancel-interview", () => ({ cancelInterviewAction: vi.fn() }));
vi.mock("@/app/actions/interviews/mark-interview", () => ({ markInterviewAction: vi.fn() }));
vi.mock("@/app/actions/interviews/update-interview", () => ({ updateInterviewAction: vi.fn() }));
vi.mock("@/app/actions/interviews/record-interview", () => ({ recordInterviewAction: vi.fn() }));
vi.mock("@/app/actions/interviews/send-scheduling-link", () => ({ renewSchedulingLinkAction: vi.fn() }));
vi.mock("@/app/actions/interviews/remind-interviewers", () => ({ remindInterviewersAction: vi.fn() }));

import { cancelInterviewAction } from "@/app/actions/interviews/cancel-interview";
import { recordInterviewAction } from "@/app/actions/interviews/record-interview";
import { renewSchedulingLinkAction } from "@/app/actions/interviews/send-scheduling-link";
import { remindInterviewersAction } from "@/app/actions/interviews/remind-interviewers";
import toast from "react-hot-toast";

const ME = "c1000000-0000-4000-8000-000000000001";
const ADA = "c1000000-0000-4000-8000-000000000002";
const BEN = "c1000000-0000-4000-8000-000000000003";
const COMP = { id: "1c000000-0000-4000-8000-000000000001", name: "Architecture", description: "", questions: [] };
const APP = "ab000000-0000-4000-8000-000000000001";

const seat = (userId: string, name: string, over: Partial<PanelSeat> = {}): PanelSeat => ({
  userId,
  name,
  response: "needs_action",
  scorecardStatus: "none",
  submittedAt: null,
  visible: false,
  overall: null,
  overallNote: null,
  ratings: null,
  ...over,
});

function interviewWith(panel: PanelSeat[], over: Partial<ApplicationInterview> = {}): ApplicationInterview {
  const submitted = panel.filter((p) => p.scorecardStatus === "submitted");
  const readable = submitted.filter((p) => p.visible);
  return {
    id: "1e000000-0000-4000-8000-000000000001",
    name: "System design",
    status: "completed",
    source: "manual",
    startsAt: "2026-11-10T10:00:00.000Z",
    endsAt: "2026-11-10T11:00:00.000Z",
    durationMinutes: 60,
    meetingUrl: null,
    stageId: "s1",
    planItemId: null,
    organizerUserId: null,
    onCalendar: false,
    competencies: [COMP],
    panel,
    submitted: submitted.length,
    hidden: submitted.length - readable.length,
    summary: [
      {
        id: COMP.id,
        name: COMP.name,
        counts: {
          strong_no: 0,
          no: 0,
          yes: readable.filter((p) => p.ratings?.[COMP.id]?.rating === "yes").length,
          strong_yes: readable.filter((p) => p.ratings?.[COMP.id]?.rating === "strong_yes").length,
        },
      },
    ],
    ...over,
  };
}

const groupsOf = (...interviews: ApplicationInterview[]): InterviewStageGroup[] => [
  { stageId: "s1", stageName: "Onsite", interviews },
];

function renderSection(
  groups: InterviewStageGroup[],
  canManage = true,
  calendar?: {
    statuses: Record<string, "connected" | "unknown" | "error">;
    returnTo: string;
    templates?: { id: string; name: string; subject: string; body: string }[];
  },
) {
  return render(
    <ApplicationInterviews
      groups={groups}
      members={[
        { userId: ME, name: "Me" },
        { userId: ADA, name: "Ada" },
      ]}
      canManage={canManage}
      currentUserId={ME}
      calendar={calendar}
    />,
  );
}

beforeEach(() => vi.clearAllMocks());

describe("ApplicationInterviews (IVT-020)", () => {
  it("a blind reader sees only who submitted: no ratings, notes or summary", () => {
    renderSection(
      groupsOf(
        interviewWith([
          seat(ME, "Me", { scorecardStatus: "draft", visible: true }),
          seat(ADA, "Ada", { scorecardStatus: "submitted" }),
          seat(BEN, "Ben", { scorecardStatus: "submitted" }),
        ]),
      ),
    );
    expect(screen.getByText("2 of 3 submitted")).toBeInTheDocument();
    expect(screen.getByText(/feedback is hidden until you submit/)).toBeInTheDocument();
    expect(screen.queryByText("By competency")).not.toBeInTheDocument();
    expect(screen.queryByText("Strong yes")).not.toBeInTheDocument();
    expect(screen.getAllByText("Submitted")).toHaveLength(2);
  });

  it("a reader who may see feedback gets the overall, notes and the per-competency counts", () => {
    renderSection(
      groupsOf(
        interviewWith([
          seat(ME, "Me", {
            scorecardStatus: "submitted",
            visible: true,
            overall: "yes",
            ratings: { [COMP.id]: { rating: "yes", note: "Clear" } },
          }),
          seat(ADA, "Ada", {
            scorecardStatus: "submitted",
            visible: true,
            overall: "strong_yes",
            overallNote: "Hire her",
            ratings: { [COMP.id]: { rating: "strong_yes", note: "" } },
          }),
        ]),
      ),
    );
    expect(screen.getByText("2 of 2 submitted")).toBeInTheDocument();
    expect(screen.getByText("Hire her")).toBeInTheDocument();
    const table = screen.getByRole("table");
    const row = within(table).getByRole("row", { name: /Architecture/ });
    expect(within(row).getAllByRole("cell").map((c) => c.textContent)).toEqual(["Architecture", "–", "–", "1", "1"]);
  });

  it("groups by stage and shows an empty state", () => {
    const { unmount } = renderSection(groupsOf(interviewWith([seat(ME, "Me")])));
    expect(screen.getByRole("region", { name: "Onsite" })).toBeInTheDocument();
    unmount();
    renderSection([]);
    expect(screen.getByText(/No interviews yet/)).toBeInTheDocument();
  });

  it("has no actions without scheduling.manage", () => {
    renderSection(groupsOf(interviewWith([seat(ME, "Me")], { status: "scheduled" })), false);
    expect(screen.queryByRole("button", { name: /Actions for/ })).not.toBeInTheDocument();
  });

  it("cancels after confirming", async () => {
    vi.mocked(cancelInterviewAction).mockResolvedValue({ ok: true, applicationId: APP, status: "cancelled" });
    renderSection(
      groupsOf(interviewWith([seat(ME, "Me")], { status: "scheduled", startsAt: "2099-01-01T10:00:00.000Z" })),
    );
    const trigger = screen.getByRole("button", { name: "Actions for System design" });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Cancel interview" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel interview" }));
    await waitFor(() =>
      expect(cancelInterviewAction).toHaveBeenCalledWith({ interviewId: "1e000000-0000-4000-8000-000000000001" }),
    );
  });

  it("links a panel member to the kit", () => {
    renderSection(groupsOf(interviewWith([seat(ME, "Me")], { status: "scheduled" })));
    expect(screen.getByRole("link", { name: "Open kit" })).toHaveAttribute(
      "href",
      "/company/interviews/1e000000-0000-4000-8000-000000000001",
    );
  });
});

describe("calendar banners (IVT-048)", () => {
  const booked = (over: Partial<ApplicationInterview> = {}) =>
    interviewWith([seat(ME, "Me")], {
      status: "scheduled",
      startsAt: "2099-01-01T10:00:00.000Z",
      organizerUserId: ADA,
      onCalendar: true,
      ...over,
    });

  it("decides each banner from the organizer's calendar", () => {
    const ok = { [ADA]: "connected" as const, [ME]: "connected" as const };
    expect(calendarBanner(booked(), ME, ok)).toBeNull();
    expect(calendarBanner(booked(), ME, { [ADA]: "unknown" })).toBe("organizer_disconnected");
    expect(calendarBanner(booked(), ME, { [ADA]: "error" })).toBe("organizer_disconnected");
    expect(calendarBanner(booked({ organizerUserId: ME }), ME, { [ME]: "error" })).toBe("reconnect");
    expect(calendarBanner(booked({ organizerUserId: ME }), ME, {})).toBe("reconnect");
    // Not on a calendar, or already over: nothing to fix.
    expect(calendarBanner(booked({ onCalendar: false }), ME, {})).toBeNull();
    expect(calendarBanner(booked({ status: "cancelled" }), ME, {})).toBeNull();
    expect(calendarBanner(booked({ status: "completed" }), ME, {})).toBeNull();
  });

  it("shows them on the interview, with a reconnect link back here", () => {
    const returnTo = `/company/applications/${APP}/interviews`;
    const { unmount } = renderSection(groupsOf(booked({ organizerUserId: ME })), true, {
      statuses: { [ME]: "error" },
      returnTo,
    });
    expect(screen.getByText(/Reconnect your Google Calendar/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Reconnect" })).toHaveAttribute(
      "href",
      `/api/calendar/google/connect?returnTo=${encodeURIComponent(returnTo)}`,
    );
    unmount();
    renderSection(groupsOf(booked()), true, { statuses: { [ADA]: "unknown" }, returnTo });
    expect(screen.getByText(/Organizer disconnected: reschedule to move it to your calendar/)).toBeInTheDocument();
  });

  it("shows nothing without calendar data (the feature is off)", () => {
    renderSection(groupsOf(booked()));
    expect(screen.queryByText(/Organizer disconnected/)).not.toBeInTheDocument();
  });

  it("tells the panel Google will email them when a booked interview is cancelled", async () => {
    renderSection(groupsOf(booked()), true, { statuses: { [ADA]: "connected" }, returnTo: "/x" });
    fireEvent.pointerDown(screen.getByRole("button", { name: "Actions for System design" }), { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Cancel interview" }));
    expect(await screen.findByText(/Google Calendar emails the attendees/)).toBeInTheDocument();
  });
});

describe("awaiting candidate (IVT-065)", () => {
  const TEMPLATE = { id: "7e000000-0000-4000-8000-000000000001", name: "Interview invite", subject: "Pick a time", body: "{{scheduling_link}}" };
  const CAL = { statuses: { [ME]: "connected" as const }, returnTo: "/x", templates: [TEMPLATE] };
  const ID = "1e000000-0000-4000-8000-000000000001";
  const waiting = (over: Partial<ApplicationInterview> = {}) =>
    interviewWith([seat(ME, "Me")], {
      status: "awaiting_candidate",
      source: "link",
      startsAt: null,
      endsAt: null,
      organizerUserId: ME,
      ...over,
    });
  const renewed = (over = {}) => ({
    ok: true as const,
    id: ID,
    applicationId: APP,
    url: "https://gethired.test/schedule/new",
    expiresAt: "2026-11-21T10:00:00.000Z",
    emailed: false,
    ...over,
  });
  const openMenu = () =>
    fireEvent.pointerDown(screen.getByRole("button", { name: "Actions for System design" }), { button: 0, ctrlKey: false });

  it("says it's waiting for the candidate, with no reschedule", async () => {
    renderSection(groupsOf(waiting()), true, CAL);
    expect(screen.getByText("Waiting for the candidate to pick a time from the link.")).toBeInTheDocument();
    openMenu();
    expect(await screen.findByRole("menuitem", { name: "Copy a new link" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Resend link" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Reschedule" })).not.toBeInTheDocument();
  });

  it("copies a new link, and says the emailed one stopped working", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    vi.mocked(renewSchedulingLinkAction).mockResolvedValue(renewed());
    renderSection(groupsOf(waiting()), true, CAL);
    openMenu();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Copy a new link" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("https://gethired.test/schedule/new"));
    expect(renewSchedulingLinkAction).toHaveBeenCalledWith({ interviewId: ID });
    expect(toast.success).toHaveBeenCalledWith("New link copied. The link in the earlier email no longer works.");
  });

  it("resends the link with a template, and warns when the email didn't go", async () => {
    vi.mocked(renewSchedulingLinkAction).mockResolvedValue(renewed({ emailed: true }));
    renderSection(groupsOf(waiting()), true, CAL);
    openMenu();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Resend link" }));
    expect(await screen.findByLabelText("Email template")).toHaveValue(TEMPLATE.id);
    fireEvent.click(screen.getByRole("button", { name: "Resend" }));
    await waitFor(() =>
      expect(renewSchedulingLinkAction).toHaveBeenCalledWith({ interviewId: ID, email: { templateId: TEMPLATE.id } }),
    );
    expect(toast.success).toHaveBeenCalledWith("Link resent. The earlier link no longer works.");

    vi.mocked(renewSchedulingLinkAction).mockResolvedValue(renewed({ emailed: false, warning: "Email failed." }));
    openMenu();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Resend link" }));
    fireEvent.click(await screen.findByRole("button", { name: "Resend" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Email failed."));
  });

  it("can't resend without a template, and offers nothing for links while Google Calendar is off", async () => {
    const { unmount } = renderSection(groupsOf(waiting()), true, { ...CAL, templates: [] });
    openMenu();
    await screen.findByRole("menuitem", { name: "Copy a new link" });
    expect(screen.queryByRole("menuitem", { name: "Resend link" })).not.toBeInTheDocument();
    unmount();
    renderSection(groupsOf(waiting()));
    openMenu();
    await screen.findByRole("menuitem", { name: "Cancel interview" });
    expect(screen.queryByRole("menuitem", { name: "Copy a new link" })).not.toBeInTheDocument();
  });

  it("says the link stops working when it's cancelled", async () => {
    renderSection(groupsOf(waiting()), true, CAL);
    openMenu();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Cancel interview" }));
    expect(await screen.findByText(/The candidate's link stops working/)).toBeInTheDocument();
  });
});

describe("reminding interviewers (IVT-084)", () => {
  const HOUR = 3_600_000;
  const startedAgo = (hours: number) => ({
    status: "completed" as const,
    startsAt: new Date(Date.now() - hours * HOUR).toISOString(),
    endsAt: new Date(Date.now() - (hours - 1) * HOUR).toISOString(),
  });

  it("reminds the panel from the menu and names who was emailed", async () => {
    vi.mocked(remindInterviewersAction).mockResolvedValue({
      ok: true,
      applicationId: APP,
      reminded: [{ userId: ADA, name: "Ada" }],
      skipped: [{ userId: BEN, name: "Ben", reason: "recent" }],
    });
    renderSection(
      groupsOf(interviewWith([seat(ME, "Me", { scorecardStatus: "submitted" }), seat(ADA, "Ada")], startedAgo(3))),
    );
    fireEvent.pointerDown(screen.getByRole("button", { name: "Actions for System design" }), { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Remind interviewers" }));
    await waitFor(() =>
      expect(remindInterviewersAction).toHaveBeenCalledWith({ interviewId: "1e000000-0000-4000-8000-000000000001" }),
    );
    expect(toast.success).toHaveBeenCalledWith("Reminded Ada. Ben was reminded in the last 24 hours.");
  });

  it("says so when everyone was reminded recently, and shows refusals", async () => {
    vi.mocked(remindInterviewersAction).mockResolvedValueOnce({
      ok: true,
      applicationId: APP,
      reminded: [],
      skipped: [{ userId: ADA, name: "Ada", reason: "recent" }],
    });
    renderSection(groupsOf(interviewWith([seat(ADA, "Ada")], startedAgo(3))));
    fireEvent.pointerDown(screen.getByRole("button", { name: "Actions for System design" }), { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Remind interviewers" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Nobody was emailed. Ada was reminded in the last 24 hours."),
    );
  });

  it("is offered once it started, while a scorecard is owed and the kit is open", () => {
    const now = Date.now();
    const owed = [{ scorecardStatus: "none" as const }];
    expect(canRemind({ ...startedAgo(3), panel: owed }, now)).toBe(true);
    expect(canRemind({ ...startedAgo(3), panel: [{ scorecardStatus: "submitted" as const }] }, now)).toBe(false);
    expect(canRemind({ ...startedAgo(24 * 8), panel: owed }, now)).toBe(false);
    expect(
      canRemind({ status: "scheduled", startsAt: new Date(now + HOUR).toISOString(), endsAt: null, panel: owed }, now),
    ).toBe(false);
    expect(
      canRemind({ status: "scheduled", startsAt: new Date(now - HOUR).toISOString(), endsAt: null, panel: owed }, now),
    ).toBe(true);
    expect(canRemind({ ...startedAgo(3), status: "no_show", panel: owed }, now)).toBe(false);
  });
});

describe("interview-view rules", () => {
  const now = Date.parse("2026-11-20T00:00:00.000Z");
  it("no-show only after the start, and within 7 days of a completed one's end", () => {
    expect(canMarkNoShow({ status: "scheduled", startsAt: "2026-11-21T00:00:00.000Z", endsAt: null }, now)).toBe(false);
    expect(canMarkNoShow({ status: "scheduled", startsAt: "2026-11-19T00:00:00.000Z", endsAt: null }, now)).toBe(true);
    expect(canMarkNoShow({ status: "completed", startsAt: null, endsAt: "2026-11-14T00:00:00.000Z" }, now)).toBe(true);
    expect(canMarkNoShow({ status: "completed", startsAt: null, endsAt: "2026-11-12T00:00:00.000Z" }, now)).toBe(false);
    expect(canMarkNoShow({ status: "cancelled", startsAt: null, endsAt: null }, now)).toBe(false);
  });
});

describe("RecordInterviewForm (IVT-020)", () => {
  const BACK = `/company/applications/${APP}/interviews`;

  const PLAN_ITEM = {
    id: "1a000000-0000-4000-8000-000000000001",
    name: "System design",
    stageName: "Onsite",
    durationMinutes: 60,
    defaultInterviewerIds: [ADA],
  };

  function renderDialog(planItems = [PLAN_ITEM]) {
    render(
      <RecordInterviewForm
        backHref={BACK}
        applicationId={APP}
        planItems={planItems}
        members={[
          { userId: ME, name: "Me" },
          { userId: ADA, name: "Ada" },
        ]}
      />,
    );
  }

  it("records a plan interview with its default interviewers", async () => {
    vi.mocked(recordInterviewAction).mockResolvedValue({ ok: true, applicationId: APP, status: "scheduled" });
    renderDialog();
    fireEvent.change(screen.getByLabelText("Starts"), { target: { value: "2026-12-01T10:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Record interview" }));

    await waitFor(() => expect(recordInterviewAction).toHaveBeenCalled());
    expect(vi.mocked(recordInterviewAction).mock.calls[0][0]).toEqual({
      applicationId: APP,
      planItemId: PLAN_ITEM.id,
      name: null,
      durationMinutes: null,
      panel: [ADA],
      startsAt: localInputToIso("2026-12-01T10:00"),
      meetingUrl: null,
    });
    await waitFor(() => expect(push).toHaveBeenCalledWith(BACK));
  });

  it("records an ad-hoc interview with a name and length", async () => {
    vi.mocked(recordInterviewAction).mockResolvedValue({ ok: true, applicationId: APP, status: "scheduled" });
    renderDialog([]);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Coffee chat" } });
    fireEvent.change(screen.getByLabelText("Minutes"), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("combobox", { name: "Interviewers" }));
    fireEvent.click(await screen.findByLabelText("Me"));
    fireEvent.change(screen.getByLabelText("Starts"), { target: { value: "2026-12-01T10:00" } });
    fireEvent.change(screen.getByLabelText("Meeting link (optional)"), { target: { value: "https://meet.test/x" } });
    fireEvent.click(screen.getByRole("button", { name: "Record interview" }));

    await waitFor(() => expect(recordInterviewAction).toHaveBeenCalled());
    expect(vi.mocked(recordInterviewAction).mock.calls[0][0]).toMatchObject({
      planItemId: null,
      name: "Coffee chat",
      durationMinutes: 30,
      panel: [ME],
      meetingUrl: "https://meet.test/x",
    });
  });

  it("validates before calling the action", async () => {
    renderDialog([]);
    fireEvent.click(screen.getByRole("button", { name: "Record interview" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(recordInterviewAction).not.toHaveBeenCalled();
  });

  it("shows the action's refusal", async () => {
    vi.mocked(recordInterviewAction).mockResolvedValue({
      ok: false,
      error: "This application is in a Rejected or Hired stage. Move it back to an open stage first.",
    });
    renderDialog();
    fireEvent.change(screen.getByLabelText("Starts"), { target: { value: "2026-12-01T10:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Record interview" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Rejected or Hired/);
  });
});
