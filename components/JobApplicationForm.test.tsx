import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "react-hot-toast";
import { mutate } from "swr";
import { submitApplicationAction } from "@/app/actions/submit-application";
import type { ApplicationForm } from "@/helpers/jobs/application-form-schema";
import { standardAnswerKey } from "@/helpers/applications/validate-answers";
import JobApplicationForm from "./JobApplicationForm";
import { ApplicationSourceProvider } from "./jobs/ApplicationSourceContext";

vi.mock("@/app/actions/submit-application", () => ({ submitApplicationAction: vi.fn() }));
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
const PICKED_FILE = vi.hoisted(() => new File(["%PDF"], "cv.pdf", { type: "application/pdf" }));
vi.mock("./ResumeSourceSelector", () => ({
  default: ({ onFileChange }: { onFileChange: (file: File) => void }) => (
    <button type="button" onClick={() => onFileChange(PICKED_FILE)}>
      upload a new resume
    </button>
  ),
}));

const USER_ID = "a0000000-0000-4000-8000-000000000001";
const RESUME_ID = "f0000000-0000-4000-8000-000000000001";
const APPLICATION_ID = "e0000000-0000-4000-8000-000000000001";
const ALL_JOBS_ID = "b1000000-0000-4000-8000-000000000001";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const jobWith = (posting: Record<string, unknown>) =>
  ({ id: ALL_JOBS_ID, job_postings: [{ id: "b2000000-0000-4000-8000-000000000001", questions: [], ...posting }] }) as never;
const JOB = jobWith({});

const onSuccess = vi.fn();

async function renderForm(job = JOB, props: { source?: "careers_page"; sourceRef?: string } = {}) {
  render(<JobApplicationForm jobPost={job} userId={USER_ID} onSuccess={onSuccess} {...props} />);
  await screen.findByRole("button", { name: /submit application/i });
}

const submit = () => fireEvent.click(screen.getByRole("button", { name: /submit application/i }));

beforeEach(() => {
  // jsdom has no scrollIntoView; a failed submit scrolls to the first error.
  Element.prototype.scrollIntoView = vi.fn();
  vi.clearAllMocks();
  window.localStorage.clear();
  vi.mocked(submitApplicationAction).mockResolvedValue({ ok: true, applicationId: APPLICATION_ID, creditsDeducted: true, interview: null });
});

describe("JobApplicationForm one page (APT-003, AP-REQ-030/031/040)", () => {
  it("has Resume and Questions sections, no steps and no share section", async () => {
    await renderForm();
    expect(screen.getByRole("heading", { name: "Resume" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Questions" })).toBeInTheDocument();
    expect(screen.getByText("No extra questions for this role")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /next step/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/share with this company/i)).not.toBeInTheDocument();
  });

  it("shows every error on one submit: a missing resume and each field", async () => {
    profile.value = { ...profile.value, resumes: [] };
    await renderForm(jobWith({ questions: ["Why us?", "Notice period?"] }));

    submit();

    expect(await screen.findAllByText("This question is required.")).toHaveLength(2);
    expect(screen.getByText("Select a resume or upload a new one.")).toBeInTheDocument();
    expect(submitApplicationAction).not.toHaveBeenCalled();
    await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: "center" }));
    profile.value = { ...profile.value, resumes: [{ id: RESUME_ID, is_primary: true }] };
  });

  it("passes the screening invite to onSuccess", async () => {
    const interview = { id: "a1000000-0000-4000-8000-000000000001", durationMinutes: 15, deadlineAt: "2026-10-24T12:00:00.000Z" };
    vi.mocked(submitApplicationAction).mockResolvedValue({ ok: true, applicationId: APPLICATION_ID, creditsDeducted: true, interview });
    await renderForm();
    submit();
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(interview));
  });
});

describe("JobApplicationForm legacy questions (CPT-000 characterisation, kept through CPT-016)", () => {
  const LEGACY = jobWith({ questions: ["Why us?", "Notice period?"] });


  it("shows one text box per question, each labelled with the question", async () => {
    await renderForm(LEGACY);
    expect(screen.getByLabelText("Why us?").tagName).toBe("TEXTAREA");
    expect(screen.getByLabelText("Notice period?").tagName).toBe("TEXTAREA");
  });

  it("requires every answer", async () => {
    await renderForm(LEGACY);
    fireEvent.change(screen.getByLabelText("Why us?"), { target: { value: "Mission" } });

    submit();

    expect(await screen.findByText("This question is required.")).toBeInTheDocument();
    expect(submitApplicationAction).not.toHaveBeenCalled();
  });

  it("submits the answers by question id and refreshes credits", async () => {
    await renderForm(LEGACY);
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

describe("JobApplicationForm with a new resume file", () => {

  it("sends the file with the application instead of uploading it first", async () => {
    render(<JobApplicationForm jobPost={JOB} userId={USER_ID} onSuccess={onSuccess} />);
    fireEvent.click(await screen.findByRole("button", { name: /upload a new resume/i }));

    submit();

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    const [input, files] = vi.mocked(submitApplicationAction).mock.calls[0];
    expect(input).toEqual({ allJobsId: ALL_JOBS_ID, answers: {} });
    expect((files as FormData).get("resume")).toBe(PICKED_FILE);
  });

  it("shows the server's error, such as running out of credits", async () => {
    vi.mocked(submitApplicationAction).mockResolvedValue({ ok: false, error: "Insufficient AI credits for resume upload." });
    render(<JobApplicationForm jobPost={JOB} userId={USER_ID} onSuccess={onSuccess} />);
    fireEvent.click(await screen.findByRole("button", { name: /upload a new resume/i }));

    submit();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Insufficient AI credits for resume upload."));
    expect(onSuccess).not.toHaveBeenCalled();
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


  it("renders the typed form, prefills from the profile and skips empty optional fields", async () => {
    await renderForm(TYPED, { source: "careers_page", sourceRef: "linkedin" });
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
    await screen.findByRole("button", { name: /submit application/i });
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
    await renderForm(TYPED);
    fireEvent.click(screen.getByRole("radio", { name: "No" }));

    submit();

    expect(await screen.findByText("Answer yes or no.")).toBeInTheDocument();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("keeps a draft per job and clears it once sent", async () => {
    const first = render(<JobApplicationForm jobPost={TYPED} userId={USER_ID} onSuccess={onSuccess} />);
    await screen.findByRole("button", { name: /submit application/i });
    fireEvent.change(screen.getByLabelText(/Nickname/), { target: { value: "Ada" } });
    first.unmount();

    await renderForm(TYPED);
    expect(screen.getByLabelText(/Nickname/)).toHaveValue("Ada");

    fireEvent.click(screen.getByRole("radio", { name: "Yes" }));
    submit();
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(window.localStorage.getItem(`gethired:apply-draft:${ALL_JOBS_ID}`)).toBeNull();
  });
});
