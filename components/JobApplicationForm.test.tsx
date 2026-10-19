import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "react-hot-toast";
import { mutate } from "swr";
import {
  attachToApplicationAction,
  listShareableSignalsAction,
} from "@/app/actions/applications/attachments";
import { submitApplicationAction } from "@/app/actions/submit-application";
import type { ApplicationForm } from "@/helpers/jobs/application-form-schema";
import { standardAnswerKey } from "@/helpers/applications/validate-answers";
import JobApplicationForm from "./JobApplicationForm";
import { ApplicationSourceProvider } from "./jobs/ApplicationSourceContext";

vi.mock("@/app/actions/applications/attachments", () => ({
  attachToApplicationAction: vi.fn(),
  listShareableSignalsAction: vi.fn(),
}));
vi.mock("@/app/actions/submit-application", () => ({ submitApplicationAction: vi.fn() }));
vi.mock("@/app/actions/upload-resume-file", () => ({ uploadResumeAction: vi.fn() }));
vi.mock("@/app/actions/revalidate-tag", () => ({ revalidateCacheAction: vi.fn() }));
vi.mock("react-hot-toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const profile = vi.hoisted(() => ({
  value: {
    resumes: [{ id: "f0000000-0000-4000-8000-000000000001", is_primary: true }],
    linkedin_url: "https://linkedin.com/in/ada" as string | null,
  },
}));
vi.mock("swr", () => ({
  default: () => ({ data: { profile: profile.value }, isLoading: false }),
  mutate: vi.fn(),
}));
vi.mock("./ResumeSourceSelector", () => ({ default: () => <div>resume picker</div> }));

const USER_ID = "a0000000-0000-4000-8000-000000000001";
const RESUME_ID = "f0000000-0000-4000-8000-000000000001";
const APPLICATION_ID = "e0000000-0000-4000-8000-000000000001";
const SESSION_ID = "15000000-0000-4000-8000-000000000001";
const REVIEW_ID = "2e000000-0000-4000-8000-000000000001";
const ALL_JOBS_ID = "b1000000-0000-4000-8000-000000000001";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const jobWith = (posting: Record<string, unknown>) =>
  ({ id: ALL_JOBS_ID, job_postings: [{ id: "b2000000-0000-4000-8000-000000000001", questions: [], ...posting }] }) as never;
const JOB = jobWith({});

const onSuccess = vi.fn();

async function goToStep2(job = JOB, props: { source?: "careers_page"; sourceRef?: string } = {}) {
  render(<JobApplicationForm jobPost={job} userId={USER_ID} onSuccess={onSuccess} {...props} />);
  fireEvent.click(await screen.findByRole("button", { name: /next step/i }));
}

const submit = () => fireEvent.click(screen.getByRole("button", { name: /submit application/i }));

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  vi.mocked(submitApplicationAction).mockResolvedValue({ ok: true, applicationId: APPLICATION_ID, creditsDeducted: true, interview: null });
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

    submit();

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(attachToApplicationAction).not.toHaveBeenCalled();
  });

  it("attaches the picked session and review after the application is created", async () => {
    await goToStep2();
    fireEvent.click(await screen.findByRole("button", { name: /backend mock/i }));
    fireEvent.click(screen.getByRole("button", { name: /resume review/i }));

    submit();

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
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

    submit();

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(toast.success).toHaveBeenCalledWith("Application sent!");
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/couldn't share/));
  });

  it("doesn't share when the application fails", async () => {
    vi.mocked(submitApplicationAction).mockResolvedValue({ ok: false, error: "You've already applied to this job." });
    await goToStep2();
    fireEvent.click(await screen.findByRole("button", { name: /backend mock/i }));

    submit();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("You've already applied to this job."));
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

describe("JobApplicationForm legacy questions (CPT-000 characterisation, kept through CPT-016)", () => {
  const LEGACY = jobWith({ questions: ["Why us?", "Notice period?"] });

  beforeEach(() => vi.mocked(listShareableSignalsAction).mockResolvedValue({ sessions: [], reviews: [] }));

  it("shows one text box per question, each labelled with the question", async () => {
    await goToStep2(LEGACY);
    expect(screen.getByLabelText("Why us?").tagName).toBe("TEXTAREA");
    expect(screen.getByLabelText("Notice period?").tagName).toBe("TEXTAREA");
  });

  it("requires every answer", async () => {
    await goToStep2(LEGACY);
    fireEvent.change(screen.getByLabelText("Why us?"), { target: { value: "Mission" } });

    submit();

    expect(await screen.findByText("This question is required.")).toBeInTheDocument();
    expect(submitApplicationAction).not.toHaveBeenCalled();
  });

  it("submits the answers by question id and refreshes credits", async () => {
    await goToStep2(LEGACY);
    fireEvent.change(screen.getByLabelText("Why us?"), { target: { value: "Mission" } });
    fireEvent.change(screen.getByLabelText("Notice period?"), { target: { value: "30 days" } });

    submit();

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(submitApplicationAction).toHaveBeenCalledWith({
      allJobsId: ALL_JOBS_ID,
      resumeId: RESUME_ID,
      answers: { [id(1)]: "Mission", [id(2)]: "30 days" },
    });
    expect(mutate).toHaveBeenCalled();
  });
});

describe("JobApplicationForm typed forms (CPT-016, AF-REQ-006)", () => {
  const FORM: ApplicationForm = {
    version: 1,
    questions: [
      { id: id(1), type: "yes_no", label: "Can you relocate?", required: true },
      { id: id(2), type: "short_text", label: "Nickname", required: false },
    ],
    standard_fields: { linkedin_url: "required" },
  };
  const TYPED = jobWith({ application_form: FORM });

  beforeEach(() => vi.mocked(listShareableSignalsAction).mockResolvedValue({ sessions: [], reviews: [] }));

  it("renders the typed form, prefills from the profile and skips empty optional fields", async () => {
    await goToStep2(TYPED, { source: "careers_page", sourceRef: "linkedin" });
    expect(screen.getByLabelText("LinkedIn profile")).toHaveValue("https://linkedin.com/in/ada");

    fireEvent.click(screen.getByRole("radio", { name: "Yes" }));
    submit();

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(submitApplicationAction).toHaveBeenCalledWith({
      allJobsId: ALL_JOBS_ID,
      resumeId: RESUME_ID,
      answers: { [id(1)]: true, [standardAnswerKey("linkedin_url")]: "https://linkedin.com/in/ada" },
      source: "careers_page",
      ref: "linkedin",
    });
  });

  it("takes the source and ref from a careers page's context (CP-REQ-013)", async () => {
    render(
      <ApplicationSourceProvider value={{ source: "careers_page", ref: "website" }}>
        <JobApplicationForm jobPost={TYPED} userId={USER_ID} onSuccess={onSuccess} />
      </ApplicationSourceProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: /next step/i }));
    fireEvent.click(screen.getByRole("radio", { name: "Yes" }));
    submit();

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(submitApplicationAction).toHaveBeenCalledWith(expect.objectContaining({ source: "careers_page", ref: "website" }));
  });

  it("shows the server's field errors on their fields", async () => {
    vi.mocked(submitApplicationAction).mockResolvedValue({
      ok: false,
      error: "Check your answers and try again.",
      fieldErrors: { [id(1)]: "Answer yes or no." },
    });
    await goToStep2(TYPED);
    fireEvent.click(screen.getByRole("radio", { name: "No" }));

    submit();

    expect(await screen.findByText("Answer yes or no.")).toBeInTheDocument();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("keeps a draft per job and clears it once sent", async () => {
    const first = render(<JobApplicationForm jobPost={TYPED} userId={USER_ID} onSuccess={onSuccess} />);
    fireEvent.click(await screen.findByRole("button", { name: /next step/i }));
    fireEvent.change(screen.getByLabelText(/Nickname/), { target: { value: "Ada" } });
    first.unmount();

    await goToStep2(TYPED);
    expect(screen.getByLabelText(/Nickname/)).toHaveValue("Ada");

    fireEvent.click(screen.getByRole("radio", { name: "Yes" }));
    submit();
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(window.localStorage.getItem(`gethired:apply-draft:${ALL_JOBS_ID}`)).toBeNull();
  });
});

describe("JobApplicationForm screening interview card (SIT-050)", () => {
  const INTERVIEW_ID = "a1000000-0000-4000-8000-000000000001";

  it("shows the interview card when the application comes with an invite", async () => {
    vi.mocked(submitApplicationAction).mockResolvedValue({
      ok: true,
      applicationId: APPLICATION_ID,
      creditsDeducted: true,
      interview: { id: INTERVIEW_ID, durationMinutes: 15, deadlineAt: "2026-10-24T12:00:00.000Z" },
    });
    await goToStep2();
    submit();

    expect(await screen.findByText(/ai interview/i, { selector: "h3" })).toBeInTheDocument();
    expect(screen.getByText(/15-minute/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /start now/i })).toHaveAttribute(
      "href",
      `/interview/screening/${INTERVIEW_ID}`,
    );
    // The dialog stays open on the card until the applicant picks.
    expect(onSuccess).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /do it later/i }));
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it("closes straight away without an invite", async () => {
    await goToStep2();
    submit();
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(screen.queryByRole("link", { name: /start now/i })).not.toBeInTheDocument();
  });
});
