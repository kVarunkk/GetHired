import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ScreeningInterviewView from "./ScreeningInterviewView";
import { recordScreeningConsentAction } from "@/app/actions/interviews/record-screening-consent";
import { declineScreeningInterviewAction } from "@/app/actions/interviews/decline-screening-interview";
import { requestScreeningAccommodationAction } from "@/app/actions/interviews/request-screening-accommodation";
import { getMyScreeningInterviewAction } from "@/app/actions/interviews/get-my-screening-interview";
import { SCREENING_CONSENT_VERSION } from "@/helpers/interview/screening/schemas";
import type { MyScreeningInterview } from "@/helpers/interview/screening/my-interviews";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("react-hot-toast", () => ({ default: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/app/actions/interviews/record-screening-consent", () => ({ recordScreeningConsentAction: vi.fn() }));
vi.mock("@/app/actions/interviews/decline-screening-interview", () => ({ declineScreeningInterviewAction: vi.fn() }));
vi.mock("@/app/actions/interviews/request-screening-accommodation", () => ({
  requestScreeningAccommodationAction: vi.fn(),
}));
vi.mock("@/app/actions/interviews/get-my-screening-interview", () => ({ getMyScreeningInterviewAction: vi.fn() }));
vi.mock("@/components/InterviewComponent", () => ({
  default: ({ screening }: { screening: { status: string } }) => <div>interview: {screening.status}</div>,
}));

const AI = "fa000000-0000-4000-8000-000000000001";

const invite = (overrides: Partial<MyScreeningInterview> = {}): MyScreeningInterview => ({
  id: AI,
  application_id: "e0000000-0000-4000-8000-000000000001",
  job_post_id: "b2000000-0000-4000-8000-000000000001",
  interview_id: "i0000000-0000-4000-8000-000000000001",
  status: "invited",
  deadline_at: "2026-10-24T12:00:00.000Z",
  max_attempts: 2,
  attempts_used: 0,
  consented_at: null as never,
  consent_version: null as never,
  completed_at: null as never,
  created_at: "2026-10-19T12:00:00.000Z",
  company_name: "Acme",
  job_title: "Backend Engineer",
  duration_minutes: 15,
  competency_names: ["System design", "Communication"],
  ...overrides,
});

const INTERVIEW = { id: "i0000000-0000-4000-8000-000000000001", interview_sessions: [] } as never;

const renderView = (overrides: Partial<MyScreeningInterview> = {}) =>
  render(<ScreeningInterviewView invite={invite(overrides)} interview={INTERVIEW} sessionHistory={[]} />);

let getUserMedia: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  getUserMedia = vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] }));
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
  vi.mocked(recordScreeningConsentAction).mockResolvedValue({ ok: true });
  vi.mocked(declineScreeningInterviewAction).mockResolvedValue({ ok: true });
  vi.mocked(requestScreeningAccommodationAction).mockResolvedValue({ ok: true });
});

describe("ScreeningInterviewView intro (SIT-053, SI-REQ-020)", () => {
  it("shows the company, role, length, competency names and the notice", () => {
    renderView();
    expect(screen.getByText("Backend Engineer at Acme")).toBeInTheDocument();
    expect(screen.getByText("15 minutes")).toBeInTheDocument();
    expect(screen.getByText("System design")).toBeInTheDocument();
    expect(screen.getByText("Communication")).toBeInTheDocument();
    expect(screen.getAllByText(/audio isn't stored/i).length).toBeGreaterThan(0);
  });

  it("keeps Continue disabled and the microphone untouched until consent", async () => {
    renderView();
    expect(screen.getByRole("button", { name: /continue to interview/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /check microphone/i })).toBeDisabled();
    expect(getUserMedia).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("checkbox"));
    expect(recordScreeningConsentAction).toHaveBeenCalledWith({ id: AI });
    // Consent alone isn't enough: the microphone has to work.
    expect(screen.getByRole("button", { name: /continue to interview/i })).toBeDisabled();

    await userEvent.click(screen.getByRole("button", { name: /check microphone/i }));
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Microphone works")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /continue to interview/i }));
    expect(screen.getByText("interview: invited")).toBeInTheDocument();
  });

  it("starts with consent ticked when the current version is stored", () => {
    renderView({ consented_at: "2026-10-19T12:00:00.000Z", consent_version: SCREENING_CONSENT_VERSION });
    expect(screen.getByRole("checkbox")).toBeChecked();
    expect(screen.getByRole("button", { name: /check microphone/i })).toBeEnabled();
  });

  it("asks for consent again when the stored version is older", () => {
    renderView({ consented_at: "2026-10-01T12:00:00.000Z", consent_version: "2026-01-01" });
    expect(screen.getByRole("checkbox")).not.toBeChecked();
  });

  it("shows the microphone failure", async () => {
    getUserMedia.mockRejectedValue(new Error("denied"));
    renderView({ consented_at: "2026-10-19T12:00:00.000Z", consent_version: SCREENING_CONSENT_VERSION });
    await userEvent.click(screen.getByRole("button", { name: /check microphone/i }));
    expect(await screen.findByText(/couldn't use your microphone/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /continue to interview/i })).toBeDisabled();
  });

  it("declines through the action after confirming", async () => {
    renderView();
    await userEvent.click(screen.getByRole("button", { name: /^decline$/i }));
    await userEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: /^decline$/i }));
    expect(declineScreeningInterviewAction).toHaveBeenCalledWith({ id: AI });
    expect(await screen.findByText("You declined this interview")).toBeInTheDocument();
  });

  it("sends an alternative-format request with the text", async () => {
    renderView();
    await userEvent.click(screen.getByRole("button", { name: /request an alternative format/i }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("button", { name: /send request/i })).toBeDisabled();
    await userEvent.type(within(dialog).getByRole("textbox"), "I have a hearing impairment.");
    await userEvent.click(within(dialog).getByRole("button", { name: /send request/i }));
    expect(requestScreeningAccommodationAction).toHaveBeenCalledWith({ id: AI, text: "I have a hearing impairment." });
    expect(await screen.findByText("Request sent")).toBeInTheDocument();
  });
});

describe("ScreeningInterviewView states", () => {
  it.each([
    ["expired", "This interview has expired"],
    ["declined", "You declined this interview"],
    ["cancelled", "This interview was cancelled"],
    ["paused", "Request sent"],
  ])("%s shows its message and no interview", (status, title) => {
    renderView({ status });
    expect(screen.getByText(title)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /continue to interview/i })).not.toBeInTheDocument();
  });

  it("goes straight to the interview once it's completed (Submitted and transcript)", () => {
    renderView({ status: "completed", attempts_used: 1 });
    expect(screen.getByText("interview: completed")).toBeInTheDocument();
  });

  it("goes straight to the interview after an interrupted attempt", () => {
    renderView({ status: "invited", attempts_used: 1 });
    expect(screen.getByText("interview: invited")).toBeInTheDocument();
  });

  it("reads the status again while an attempt is still being saved", async () => {
    vi.mocked(getMyScreeningInterviewAction).mockResolvedValue({
      ok: true,
      interview: invite({ status: "completed", attempts_used: 1 }),
    });
    renderView({ status: "in_progress", attempts_used: 1 });
    expect(screen.getByText("interview: in_progress")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("interview: completed")).toBeInTheDocument(), { timeout: 4000 });
    expect(getMyScreeningInterviewAction).toHaveBeenCalledWith({ id: AI });
  });
});

