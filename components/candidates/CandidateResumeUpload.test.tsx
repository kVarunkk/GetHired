import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import toast from "react-hot-toast";
import {
  createCandidateResumeUploadAction,
  uploadCandidateResumeAction,
} from "@/app/actions/candidates/upload-candidate-resume";
import CandidateResumeUpload from "./CandidateResumeUpload";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));
vi.mock("react-hot-toast", () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/app/actions/candidates/upload-candidate-resume", () => ({
  createCandidateResumeUploadAction: vi.fn(),
  uploadCandidateResumeAction: vi.fn(),
}));
const uploadToSignedUrl = vi.fn();
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ storage: { from: () => ({ uploadToSignedUrl }) } }),
}));

const CANDIDATE = "cc000000-0000-4000-8000-000000000001";
const PATH = `co/candidates/${CANDIDATE}/f.pdf`;
const pdf = () => new File(["%PDF-"], "Ada CV.pdf", { type: "application/pdf" });
const choose = (file: File) => fireEvent.change(screen.getByLabelText("Choose a resume"), { target: { files: [file] } });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createCandidateResumeUploadAction).mockResolvedValue({ ok: true, path: PATH, token: "t" });
  uploadToSignedUrl.mockResolvedValue({ data: {}, error: null });
  vi.mocked(uploadCandidateResumeAction).mockResolvedValue({ ok: true, warnings: [], rescreened: 2 });
});

describe("CandidateResumeUpload (BIT-049, BI-REQ-008)", () => {
  it("uploads to the signed URL, reads it and refreshes", async () => {
    render(<CandidateResumeUpload candidateId={CANDIDATE} hasResume={false} />);
    expect(screen.getByRole("button", { name: "Upload resume" })).toBeInTheDocument();
    const file = pdf();
    choose(file);
    await vi.waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(createCandidateResumeUploadAction).toHaveBeenCalledWith({
      candidateId: CANDIDATE,
      file: { name: "Ada CV.pdf", size: 5, type: "application/pdf" },
    });
    expect(uploadToSignedUrl).toHaveBeenCalledWith(PATH, "t", file);
    expect(uploadCandidateResumeAction).toHaveBeenCalledWith({ candidateId: CANDIDATE, path: PATH });
    expect(toast.success).toHaveBeenCalledWith("Resume saved. Screening 2 applications again.");
  });

  it("refuses a wrong file type without uploading", async () => {
    render(<CandidateResumeUpload candidateId={CANDIDATE} hasResume />);
    expect(screen.getByRole("button", { name: "Replace resume" })).toBeInTheDocument();
    choose(new File(["x"], "cv.doc"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Use a PDF or Word (.docx) file.");
    expect(createCandidateResumeUploadAction).not.toHaveBeenCalled();
  });

  it("shows why it couldn't read the file, and what it didn't use", async () => {
    vi.mocked(uploadCandidateResumeAction).mockResolvedValueOnce({ ok: false, error: "No text found: is it a scan?" });
    render(<CandidateResumeUpload candidateId={CANDIDATE} hasResume={false} />);
    choose(pdf());
    expect(await screen.findByRole("alert")).toHaveTextContent("No text found: is it a scan?");
    expect(refresh).not.toHaveBeenCalled();

    vi.mocked(uploadCandidateResumeAction).mockResolvedValueOnce({
      ok: true,
      rescreened: 0,
      warnings: [{ field: "email", message: "Enter a valid email address.", value: "x" }],
    });
    choose(pdf());
    expect(await screen.findByText("Email: Enter a valid email address.")).toBeInTheDocument();
  });

  it("shows the plan's limit", async () => {
    vi.mocked(uploadCandidateResumeAction).mockResolvedValue({
      error: { code: "entitlement", message: "You've used 25 of 25 resume imports this period." } as never,
    });
    render(<CandidateResumeUpload candidateId={CANDIDATE} hasResume={false} />);
    choose(pdf());
    expect(await screen.findByRole("alert")).toHaveTextContent("You've used 25 of 25 resume imports this period.");
  });
});
