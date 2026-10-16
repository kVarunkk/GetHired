import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "react-hot-toast";
import { createClient } from "@/lib/supabase/client";
import {
  attachToApplicationAction,
  listShareableSignalsAction,
} from "@/app/actions/applications/attachments";
import { deductApplicationCreditsAction } from "@/app/actions/deduct-application-credits";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import JobApplicationForm from "./JobApplicationForm";

vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn() }));
vi.mock("@/app/actions/applications/attachments", () => ({
  attachToApplicationAction: vi.fn(),
  listShareableSignalsAction: vi.fn(),
}));
vi.mock("@/app/actions/deduct-application-credits", () => ({ deductApplicationCreditsAction: vi.fn() }));
vi.mock("@/app/actions/upload-resume-file", () => ({ uploadResumeAction: vi.fn() }));
vi.mock("@/app/actions/revalidate-tag", () => ({ revalidateCacheAction: vi.fn() }));
vi.mock("react-hot-toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("swr", () => ({
  default: () => ({
    data: { profile: { resumes: [{ id: "r0000000-0000-4000-8000-000000000001", is_primary: true }] } },
    isLoading: false,
  }),
  mutate: vi.fn(),
}));
vi.mock("./ResumeSourceSelector", () => ({ default: () => <div>resume picker</div> }));

const USER_ID = "a0000000-0000-4000-8000-000000000001";
const APPLICATION_ID = "e0000000-0000-4000-8000-000000000001";
const SESSION_ID = "15000000-0000-4000-8000-000000000001";
const REVIEW_ID = "2e000000-0000-4000-8000-000000000001";
const JOB = {
  id: "b1000000-0000-4000-8000-000000000001",
  job_postings: [{ id: "b2000000-0000-4000-8000-000000000001", questions: [] }],
} as never;

let supabase: SupabaseMock;
const onSuccess = vi.fn();

async function goToStep2() {
  render(<JobApplicationForm jobPost={JOB} userId={USER_ID} onSuccess={onSuccess} />);
  fireEvent.click(await screen.findByRole("button", { name: /next step/i }));
}

beforeEach(() => {
  vi.clearAllMocks();
  supabase = createSupabaseMock();
  vi.mocked(createClient).mockReturnValue(supabase.client);
  supabase.queue("applications", { data: { id: APPLICATION_ID }, error: null });
  vi.mocked(deductApplicationCreditsAction).mockResolvedValue({ success: false } as never);
  vi.mocked(attachToApplicationAction).mockResolvedValue({ ok: true, attachmentId: "x", analysisQueued: true });
  vi.mocked(listShareableSignalsAction).mockResolvedValue({
    sessions: [{ id: SESSION_ID, label: "Backend mock", endedAt: "2026-10-10T00:00:00.000Z" }],
    reviews: [{ id: REVIEW_ID, label: "Resume review", score: 82 }],
  });
});

describe("JobApplicationForm share step (ORT-064, OR-REQ-030/033)", () => {
  it("lists completed sessions and reviews, and shares nothing unless picked", async () => {
    await goToStep2();
    expect(await screen.findByRole("button", { name: /backend mock/i })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("Share with this company (optional)")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /submit application/i }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(attachToApplicationAction).not.toHaveBeenCalled();
  });

  it("attaches the picked session and review after the application insert", async () => {
    await goToStep2();
    fireEvent.click(await screen.findByRole("button", { name: /backend mock/i }));
    fireEvent.click(screen.getByRole("button", { name: /resume review/i }));

    fireEvent.click(screen.getByRole("button", { name: /submit application/i }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(supabase.callsFor("applications")[0].chain.map((m) => m.method)).toEqual(["insert", "select", "single"]);
    expect(attachToApplicationAction).toHaveBeenCalledWith({
      applicationId: APPLICATION_ID,
      kind: "interview_session",
      interviewSessionId: SESSION_ID,
    });
    expect(attachToApplicationAction).toHaveBeenCalledWith({
      applicationId: APPLICATION_ID,
      kind: "resume_review",
      resumeReviewId: REVIEW_ID,
    });
  });

  it("a failed share doesn't fail the application", async () => {
    vi.mocked(attachToApplicationAction).mockResolvedValue({ ok: false, error: "nope" });
    await goToStep2();
    fireEvent.click(await screen.findByRole("button", { name: /backend mock/i }));

    fireEvent.click(screen.getByRole("button", { name: /submit application/i }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(toast.success).toHaveBeenCalledWith("Application sent!");
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/couldn't share/));
  });

  it("doesn't share when the application insert fails", async () => {
    supabase.reset();
    supabase.queue("applications", { data: null, error: { message: "denied" } });
    await goToStep2();
    fireEvent.click(await screen.findByRole("button", { name: /backend mock/i }));

    fireEvent.click(screen.getByRole("button", { name: /submit application/i }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(attachToApplicationAction).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("suggests a mock interview for this job when there's none to share", async () => {
    vi.mocked(listShareableSignalsAction).mockResolvedValue({ sessions: [], reviews: [] });
    await goToStep2();

    const link = await screen.findByRole("link", { name: /stand out: share a 10-minute ai interview/i });
    expect(link).toHaveAttribute("href", `/interview?create=true&jobUrl=${encodeURIComponent("/jobs/b1000000-0000-4000-8000-000000000001")}`);
  });
});
