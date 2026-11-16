import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { agentPromptHref, COMPANY_AGENT_PATH } from "@/helpers/agent/prompt-draft";
import { scheduleHandoffPrompt } from "@/components/agent/recruiter/AskAgentAboutInterviews";
import InterviewScheduler, { CANDIDATE_NOT_INVITED, CalendarBadge, type SchedulerCalendar } from "./InterviewScheduler";
import type { SchedulerPlanItem } from "./scheduler-machine";

vi.mock("@/components/ui/select", () => import("@/test/utils/select-mock"));
vi.mock("react-hot-toast", () => ({ default: { success: vi.fn(), error: vi.fn() } }));
const refresh = vi.fn();
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push }) }));
vi.mock("@/app/actions/interviews/find-slots", () => ({ findInterviewSlotsAction: vi.fn() }));
vi.mock("@/app/actions/interviews/book-interview", () => ({ bookInterviewAction: vi.fn() }));
vi.mock("@/app/actions/interviews/record-interview", () => ({ recordInterviewAction: vi.fn() }));
vi.mock("@/app/actions/interviews/send-scheduling-link", () => ({ sendSchedulingLinkAction: vi.fn() }));

import { findInterviewSlotsAction } from "@/app/actions/interviews/find-slots";
import { bookInterviewAction } from "@/app/actions/interviews/book-interview";
import { sendSchedulingLinkAction } from "@/app/actions/interviews/send-scheduling-link";
import { SCHEDULING_MESSAGES } from "@/helpers/calendar/copy";
import toast from "react-hot-toast";

const ME = "c1000000-0000-4000-8000-000000000001";
const ADA = "c1000000-0000-4000-8000-000000000002";
const APP = "ab000000-0000-4000-8000-000000000001";
const JOB = "b0000000-0000-4000-8000-0000000000a1";
const ITEM = {
  id: "1a000000-0000-4000-8000-000000000001",
  name: "System design",
  stageName: "Onsite",
  durationMinutes: 60,
  defaultInterviewerIds: [ADA],
};
const SLOT = { start: "2026-12-01T10:00:00.000Z", end: "2026-12-01T11:00:00.000Z" };
const TEMPLATE = {
  id: "7e000000-0000-4000-8000-000000000001",
  name: "Interview invite",
  subject: "Pick a time with {{company_name}}",
  body: "Hi {{candidate_first_name}}, pick a time: {{scheduling_link}}",
};
const BACK = `/company/applications/${APP}/interviews`;
const RETURN_TO = `${BACK}/schedule`;

const calendarWith = (over: Partial<SchedulerCalendar> = {}): SchedulerCalendar => ({
  own: "active",
  members: { [ME]: "connected", [ADA]: "connected" },
  candidateInvitable: true,
  ...over,
});

function renderScheduler(
  calendar = calendarWith(),
  templates = [TEMPLATE],
  { agentHandoff = false, planItems = [ITEM] as SchedulerPlanItem[] } = {},
) {
  render(
    <InterviewScheduler
      applicationId={APP}
      jobPostId={JOB}
      planItems={planItems}
      members={[
        { userId: ME, name: "Me" },
        { userId: ADA, name: "Ada" },
      ]}
      calendar={calendar}
      returnTo={RETURN_TO}
      backHref={BACK}
      templates={templates}
      agentHandoff={agentHandoff}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("InterviewScheduler (IVT-045)", () => {
  it("marks a plan interview that's already scheduled, can't pick it, and starts on the next one", () => {
    const next = { ...ITEM, id: "1a000000-0000-4000-8000-000000000002", name: "Culture" };
    renderScheduler(calendarWith(), [TEMPLATE], { planItems: [{ ...ITEM, scheduled: true }, next] });

    const select = screen.getAllByLabelText("Interview")[0] as HTMLSelectElement;
    expect(select.value).toBe(next.id);
    const taken = within(select).getByRole("option", { name: /System design.*already scheduled/ }) as HTMLOptionElement;
    expect(taken.disabled).toBe(true);
    expect((within(select).getByRole("option", { name: /Culture/ }) as HTMLOptionElement).disabled).toBe(false);
  });

  it("finds the panel's times and books the one picked", async () => {
    vi.mocked(findInterviewSlotsAction).mockResolvedValue({
      ok: true,
      slots: [SLOT],
      members: [{ userId: ADA, status: "connected", availabilityKnown: true }],
    });
    vi.mocked(bookInterviewAction).mockResolvedValue({
      ok: true,
      id: "i1",
      applicationId: APP,
      candidateInvited: true,
      meetingUrl: "https://meet.google.com/x",
    });
    renderScheduler();

    const book = screen.getByRole("button", { name: "Book interview" });
    expect(book).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Find times" }));
    await waitFor(() => expect(findInterviewSlotsAction).toHaveBeenCalledWith({ jobPostId: JOB, panel: [ADA], durationMinutes: 60 }));

    const slot = await screen.findByRole("button", { pressed: false, name: /\d\d:\d\d/ });
    fireEvent.click(slot);
    expect(book).toBeEnabled();
    fireEvent.click(book);

    await waitFor(() => expect(bookInterviewAction).toHaveBeenCalled());
    expect(vi.mocked(bookInterviewAction).mock.calls[0][0]).toEqual({
      applicationId: APP,
      planItemId: ITEM.id,
      name: null,
      durationMinutes: null,
      panel: [ADA],
      startsAt: SLOT.start,
    });
    await waitFor(() => expect(push).toHaveBeenCalledWith(BACK));
    expect(refresh).toHaveBeenCalled();
  });

  it("says who it couldn't check and keeps the slots after a refusal", async () => {
    vi.mocked(findInterviewSlotsAction).mockResolvedValue({
      ok: true,
      slots: [SLOT],
      members: [
        { userId: ADA, status: "connected", availabilityKnown: true },
        { userId: ME, status: "unknown", availabilityKnown: false },
      ],
    });
    vi.mocked(bookInterviewAction).mockResolvedValue({ ok: false, reason: "calendar_failed", error: "Google said no." });
    renderScheduler();
    fireEvent.click(screen.getByRole("button", { name: "Find times" }));
    expect(await screen.findByText(/Availability unknown for Me/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { pressed: false, name: /\d\d:\d\d/ }));
    fireEvent.click(screen.getByRole("button", { name: "Book interview" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Google said no.");
    expect(screen.getByRole("button", { pressed: true, name: /\d\d:\d\d/ })).toBeInTheDocument();
  });

  it("can't book without a connected calendar, and links to connecting it back here", () => {
    renderScheduler(calendarWith({ own: null }));
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Book" }));
    expect(screen.getByRole("button", { name: "Find times" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Book interview" })).toBeDisabled();
    expect(screen.getByRole("link", { name: "Connect Google Calendar" })).toHaveAttribute(
      "href",
      `/api/calendar/google/connect?returnTo=${encodeURIComponent(RETURN_TO)}`,
    );
  });

  it("opens on Record manually without a calendar, and asks to reconnect a broken one", () => {
    renderScheduler(calendarWith({ own: "error" }));
    expect(screen.getByRole("tab", { name: "Record manually" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText("Starts")).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Book" }));
    expect(screen.getByRole("link", { name: "Reconnect Google Calendar" })).toBeInTheDocument();
  });

  it("says when the candidate won't get an invite (D20)", () => {
    renderScheduler(calendarWith({ candidateInvitable: false }));
    expect(screen.getByText(CANDIDATE_NOT_INVITED)).toBeInTheDocument();
    renderScheduler();
    expect(screen.getAllByText(CANDIDATE_NOT_INVITED)).toHaveLength(1);
  });
});

describe("InterviewScheduler: Send link (IVT-065)", () => {
  const openLinkTab = () => fireEvent.mouseDown(screen.getByRole("tab", { name: "Send link" }));

  it("sends the link with the interview, the panel and the email as edited", async () => {
    vi.mocked(sendSchedulingLinkAction).mockResolvedValue({
      ok: true,
      id: "i1",
      applicationId: APP,
      url: "https://gethired.test/schedule/x",
      expiresAt: "2026-11-21T10:00:00.000Z",
    });
    renderScheduler();
    openLinkTab();
    expect(screen.getByLabelText("Subject")).toHaveValue(TEMPLATE.subject);
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Pick one: {{scheduling_link}}" } });
    const send = screen.getByRole("button", { name: "Send link" });
    expect(send).toBeEnabled();
    fireEvent.click(send);

    await waitFor(() => expect(sendSchedulingLinkAction).toHaveBeenCalled());
    expect(vi.mocked(sendSchedulingLinkAction).mock.calls[0][0]).toEqual({
      applicationId: APP,
      planItemId: ITEM.id,
      name: null,
      durationMinutes: null,
      panel: [ADA],
      templateId: TEMPLATE.id,
      subject: TEMPLATE.subject,
      body: "Pick one: {{scheduling_link}}",
    });
    await waitFor(() => expect(push).toHaveBeenCalledWith(BACK));
    expect(toast.success).toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
  });

  it("is open when every panel member is connected, and says who isn't otherwise", () => {
    renderScheduler(calendarWith({ members: { [ME]: "connected", [ADA]: "error" } }));
    openLinkTab();
    expect(screen.getByRole("button", { name: "Send link" })).toBeDisabled();
    expect(screen.getByText(SCHEDULING_MESSAGES.panel_not_connected)).toBeInTheDocument();
    expect(screen.getByText("Not connected: Ada.")).toBeInTheDocument();
  });

  it("can't send without the member's own calendar, and links to connecting it", () => {
    renderScheduler(calendarWith({ own: null }));
    openLinkTab();
    expect(screen.getByRole("button", { name: "Send link" })).toBeDisabled();
    expect(screen.getByText("Connect your Google Calendar to send scheduling links.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Connect Google Calendar" })).toBeInTheDocument();
  });

  it("can't send to a candidate who can't get emails (D20)", () => {
    renderScheduler(calendarWith({ candidateInvitable: false }));
    openLinkTab();
    expect(screen.getByRole("button", { name: "Send link" })).toBeDisabled();
    expect(screen.getByText(SCHEDULING_MESSAGES.no_candidate_email)).toBeInTheDocument();
  });

  it("needs a template, and the link in the message", () => {
    renderScheduler(calendarWith(), []);
    openLinkTab();
    expect(screen.getByRole("button", { name: "Send link" })).toBeDisabled();
    expect(screen.getByText(/Add an interview invite template/)).toBeInTheDocument();
  });

  it("asks for {{scheduling_link}} when the message drops it, and shows a refusal", async () => {
    vi.mocked(sendSchedulingLinkAction).mockResolvedValue({ ok: false, reason: "daily_cap", error: "Cap reached." });
    renderScheduler();
    openLinkTab();
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "no link" } });
    expect(screen.getByText(SCHEDULING_MESSAGES.needs_link)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send link" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "{{scheduling_link}}" } });
    fireEvent.click(screen.getByRole("button", { name: "Send link" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Cap reached.");
  });
});

describe("the page (IVT-072, D8)", () => {
  it("is a page, not a dialog, and starts on the first item", () => {
    const OTHER = { ...ITEM, id: "1a000000-0000-4000-8000-000000000002", name: "Culture" };
    renderScheduler(calendarWith(), [TEMPLATE], { planItems: [OTHER, ITEM] });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Interview")).toHaveValue(OTHER.id);
  });

  it("Cancel goes back to the Interviews section", () => {
    renderScheduler();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(push).toHaveBeenCalledWith(BACK);
  });
});

describe("CalendarBadge (IV-REQ-012)", () => {
  it.each([
    ["connected", "Calendar connected"],
    ["unknown", "Availability unknown"],
    ["error", "Calendar needs reconnecting"],
  ] as const)("%s", (status, label) => {
    render(<CalendarBadge status={status} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });
});

describe("the agent handoff (IVT-086)", () => {
  it("is shown only with agent.use", () => {
    renderScheduler();
    expect(screen.queryByRole("form", { name: "Or tell the agent what to book" })).not.toBeInTheDocument();
  });

  it("hands the request, with the application's id, to the company agent", () => {
    renderScheduler(calendarWith(), [TEMPLATE], { agentHandoff: true });
    const form = screen.getByRole("form", { name: "Or tell the agent what to book" });
    fireEvent.change(within(form).getByRole("textbox"), { target: { value: "An hour with Ada on Tuesday" } });
    fireEvent.submit(form);
    expect(push).toHaveBeenCalledWith(
      agentPromptHref(scheduleHandoffPrompt(APP, "An hour with Ada on Tuesday"), COMPANY_AGENT_PATH),
    );
  });
});
