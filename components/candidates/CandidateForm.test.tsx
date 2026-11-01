import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import toast from "react-hot-toast";
import { checkCandidateEmailAction } from "@/app/actions/candidates/check-candidate-email";
import { createCandidateAction } from "@/app/actions/candidates/create-candidate";
import { uploadCandidateResume } from "./upload-candidate-resume";
import CandidateForm from "./CandidateForm";
import type { DestinationPage } from "./ImportDestination";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/components/ui/select", () => import("@/test/utils/select-mock"));
vi.mock("react-hot-toast", () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/app/actions/candidates/check-candidate-email", () => ({ checkCandidateEmailAction: vi.fn() }));
vi.mock("@/app/actions/candidates/create-candidate", () => ({ createCandidateAction: vi.fn() }));
vi.mock("./upload-candidate-resume", () => ({ uploadCandidateResume: vi.fn() }));
// The email check is debounced; run it at once.
vi.mock("@/hooks/useDebounce", () => ({ useDebounce: <T,>(value: T) => value }));
// Radix's checkbox measures itself; jsdom has no ResizeObserver.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

const JOB = { id: "b0000000-0000-4000-8000-0000000000a1", title: "Backend Engineer", interview: null };
const LIST = "71000000-0000-4000-8000-000000000001";
const STAGES = [
  { id: "50000000-0000-4000-8000-000000000001", name: "Applied" },
  { id: "50000000-0000-4000-8000-000000000002", name: "Screening" },
];
const CANDIDATE_ID = "cc000000-0000-4000-8000-000000000001";

const PAGE: DestinationPage = {
  jobs: [JOB],
  stages: STAGES,
  lists: null,
  allowNoJob: true,
  screeningsRemaining: null,
  fixedJob: null,
};
const renderForm = (page: Partial<DestinationPage> = {}) =>
  render(<CandidateForm page={{ ...PAGE, ...page }} cancelHref="/company/candidates" />);

const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const attest = () => fireEvent.click(screen.getByRole("checkbox"));
const submit = () => fireEvent.click(screen.getByRole("button", { name: "Add candidate" }));
const choose = (label: string, option: string) =>
  fireEvent.change(screen.getByRole("combobox", { name: label }), { target: { value: option } });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(checkCandidateEmailAction).mockResolvedValue({ ok: true, existing: null });
  vi.mocked(createCandidateAction).mockResolvedValue({ ok: true, candidateId: CANDIDATE_ID, addedToJob: false });
});

describe("CandidateForm (BI-REQ-009)", () => {
  it("can't be sent until the lawful basis is ticked, and says nobody is emailed", () => {
    renderForm();

    expect(screen.getByRole("button", { name: "Add candidate" })).toBeDisabled();
    expect(screen.getByText("No one will be emailed by this import.")).toBeInTheDocument();
    attest();
    expect(screen.getByRole("button", { name: "Add candidate" })).toBeEnabled();
  });

  it("adds them to the pool and opens their page", async () => {
    renderForm();
    type("Name", "Meera Iyer");
    type("Email", "Meera@Mail.test");
    type("Basis (optional)", "Referral");
    attest();
    submit();

    await waitFor(() => expect(push).toHaveBeenCalledWith(`/company/candidates/${CANDIDATE_ID}`));
    expect(createCandidateAction).toHaveBeenCalledWith(
      expect.objectContaining({ full_name: "Meera Iyer", email: "Meera@Mail.test", attested: true, lawfulBasisNote: "Referral" }),
    );
    expect(vi.mocked(createCandidateAction).mock.calls[0][0]).not.toHaveProperty("jobPostId");
    expect(toast.success).toHaveBeenCalledWith("Candidate added.");
  });

  it("reads an optional resume after saving (BIT-049)", async () => {
    vi.mocked(uploadCandidateResume).mockResolvedValue({ ok: true, warnings: [], rescreened: 0 });
    renderForm();
    type("Name", "Meera Iyer");
    const file = new File(["%PDF-"], "meera.pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByLabelText("Resume (optional)"), { target: { files: [file] } });
    attest();
    submit();

    await waitFor(() => expect(push).toHaveBeenCalledWith(`/company/candidates/${CANDIDATE_ID}`));
    expect(uploadCandidateResume).toHaveBeenCalledWith(CANDIDATE_ID, file);
  });

  it("opens the resume section when the resume couldn't be read", async () => {
    vi.mocked(uploadCandidateResume).mockResolvedValue({ ok: false, error: "No text found: is it a scan?" });
    renderForm();
    type("Name", "Meera Iyer");
    fireEvent.change(screen.getByLabelText("Resume (optional)"), {
      target: { files: [new File(["x"], "meera.pdf", { type: "application/pdf" })] },
    });
    attest();
    submit();

    await waitFor(() => expect(push).toHaveBeenCalledWith(`/company/candidates/${CANDIDATE_ID}/resume`));
    expect(toast.error).toHaveBeenCalledWith("The resume wasn't saved: No text found: is it a scan?");
  });

  it("refuses a resume of the wrong type before saving", () => {
    renderForm();
    type("Name", "Meera Iyer");
    fireEvent.change(screen.getByLabelText("Resume (optional)"), { target: { files: [new File(["x"], "cv.doc")] } });
    attest();
    expect(screen.getByText("Use a PDF or Word (.docx) file.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add candidate" })).toBeDisabled();
  });

  it("shows the import schema's messages before sending", async () => {
    renderForm();
    type("Email", "nope");
    type("Years of experience", "70");
    attest();
    submit();

    expect(await screen.findByText("Add a name.")).toBeInTheDocument();
    expect(screen.getByText("Enter a valid email address.")).toBeInTheDocument();
    expect(screen.getByText("Use 0 to 60 years.")).toBeInTheDocument();
    expect(createCandidateAction).not.toHaveBeenCalled();
  });

  it("needs an email with a job, and sends the job and stage", async () => {
    vi.mocked(createCandidateAction).mockResolvedValue({ ok: true, candidateId: CANDIDATE_ID, addedToJob: true });
    renderForm({ fixedJob: JOB });
    expect(screen.getByText("Importing into")).toHaveTextContent("Backend Engineer");
    type("Name", "Meera Iyer");
    attest();
    submit();

    expect(await screen.findByText("Add an email first: everyone in a job needs one.")).toBeInTheDocument();
    expect(createCandidateAction).not.toHaveBeenCalled();

    type("Email", "meera@mail.test");
    choose("Stage", STAGES[1].id);
    submit();

    await waitFor(() =>
      expect(createCandidateAction).toHaveBeenCalledWith(
        expect.objectContaining({ jobPostId: JOB.id, stageId: STAGES[1].id }),
      ),
    );
    expect(toast.success).toHaveBeenCalledWith("Candidate added to the job.");
  });

  it("offers the pool or a job, and the stage only once a job is picked", () => {
    renderForm();

    expect(screen.getByRole("combobox", { name: "Add them to" })).toHaveValue("pool");
    expect(screen.queryByRole("combobox", { name: "Stage" })).not.toBeInTheDocument();
    choose("Add them to", "job");
    expect(screen.getByRole("combobox", { name: "Job" })).toHaveValue(JOB.id);
    const stage = screen.getByRole("combobox", { name: "Stage" });
    expect(stage).toHaveValue("first");
    expect(stage).toHaveTextContent("First stage (Applied)");
  });

  it("makes a member scoped to some jobs pick one", () => {
    renderForm({ allowNoJob: false });

    expect(screen.getByRole("combobox", { name: "Job" })).toHaveValue(JOB.id);
    expect(screen.queryByRole("combobox", { name: "Add them to" })).not.toBeInTheDocument();
  });

  it("adds them to a talent list, with or without a job (CPT-017)", async () => {
    renderForm({ lists: [{ id: LIST, name: "Referrals", slug: "referrals" }] });
    type("Name", "Meera Iyer");
    attest();
    choose("Add them to", "list");
    expect(screen.getByRole("button", { name: "Add candidate" })).toBeDisabled();
    choose("Talent list", LIST);
    submit();
    await waitFor(() => expect(createCandidateAction).toHaveBeenCalledWith(expect.objectContaining({ talentListId: LIST })));
    expect(vi.mocked(createCandidateAction).mock.calls[0][0]).not.toHaveProperty("jobPostId");

    vi.mocked(createCandidateAction).mockClear();
    choose("Add them to", "job");
    type("Email", "meera@mail.test");
    choose("Talent list", "new");
    fireEvent.change(screen.getByRole("textbox", { name: "New list name" }), { target: { value: "Backend shortlist" } });
    submit();
    await waitFor(() =>
      expect(createCandidateAction).toHaveBeenCalledWith(
        expect.objectContaining({ jobPostId: JOB.id, newListName: "Backend shortlist" }),
      ),
    );
  });

  it("doesn't need an email for a list without a job", async () => {
    renderForm({ lists: [{ id: LIST, name: "Referrals", slug: "referrals" }] });
    type("Name", "Meera Iyer");
    attest();
    choose("Add them to", "list");
    choose("Talent list", LIST);
    submit();
    await waitFor(() => expect(createCandidateAction).toHaveBeenCalled());
  });

  it("hides the job picker when there's no job to add them to", () => {
    renderForm({ jobs: [] });

    expect(screen.queryByRole("combobox", { name: "Job" })).not.toBeInTheDocument();
  });

  it("offers to open an existing candidate with this email", async () => {
    vi.mocked(checkCandidateEmailAction).mockResolvedValue({
      ok: true,
      existing: { kind: "candidate", id: CANDIDATE_ID, href: `/company/candidates/${CANDIDATE_ID}` },
    });
    renderForm();
    type("Email", "meera@mail.test");
    attest();

    expect(await screen.findByRole("link", { name: "Open" })).toHaveAttribute("href", `/company/candidates/${CANDIDATE_ID}`);
    expect(screen.getByText(/Already one of your candidates/)).toBeInTheDocument();
    expect(checkCandidateEmailAction).toHaveBeenLastCalledWith({ email: "meera@mail.test" });
    expect(screen.getByRole("button", { name: "Add candidate" })).toBeDisabled();
  });

  it("says a known GetHired user is already in the pipeline", async () => {
    const userId = "a1000000-0000-4000-8000-000000000001";
    vi.mocked(checkCandidateEmailAction).mockResolvedValue({
      ok: true,
      existing: { kind: "user", id: userId, href: `/company/profiles/${userId}` },
    });
    renderForm();
    type("Email", "priya@mail.test");

    expect(await screen.findByText(/Already in your pipeline/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View profile" })).toHaveAttribute("href", `/company/profiles/${userId}`);
  });

  it("doesn't check an email that isn't one yet", () => {
    renderForm();
    type("Email", "meera@");

    expect(checkCandidateEmailAction).not.toHaveBeenCalled();
  });

  it("shows the server's refusal", async () => {
    vi.mocked(createCandidateAction).mockResolvedValue({
      ok: false,
      error: "You've added a lot of candidates in the last hour. Try again later.",
    });
    renderForm();
    type("Name", "Meera Iyer");
    attest();
    submit();

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("You've added a lot of candidates in the last hour. Try again later."),
    );
    expect(push).not.toHaveBeenCalled();
  });

  it("cancels back", () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(push).toHaveBeenCalledWith("/company/candidates");
  });
});
