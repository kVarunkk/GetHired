import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ResumeUploadWidget, { type ResumeUploadOutput } from "./ResumeUploadWidget";
import { uploadResumeAction } from "@/app/actions/upload-resume-file";

vi.mock("@/app/actions/upload-resume-file", () => ({ uploadResumeAction: vi.fn() }));

const pdf = (size = 1024) =>
  new File([new Uint8Array(size)], "cv.pdf", { type: "application/pdf" });

let onComplete: Mock<(output: ResumeUploadOutput) => void>;

beforeEach(() => {
  onComplete = vi.fn();
  render(<ResumeUploadWidget reason="so I can review it" onComplete={onComplete} />);
});

describe("ResumeUploadWidget", () => {
  it("uploads a PDF and reports the new resume id", async () => {
    vi.mocked(uploadResumeAction).mockResolvedValue({ success: true, resumeId: "r9" });

    await userEvent.upload(screen.getByLabelText("Resume PDF"), pdf());
    await userEvent.click(screen.getByRole("button", { name: "Upload" }));

    const formData = vi.mocked(uploadResumeAction).mock.calls[0][0];
    expect((formData.get("file") as File).name).toBe("cv.pdf");
    expect(onComplete).toHaveBeenCalledWith({ resumeId: "r9" });
  });

  it("disables upload until a file is chosen", () => {
    expect(screen.getByRole("button", { name: "Upload" })).toBeDisabled();
  });

  it("rejects non-PDF files before uploading", async () => {
    const input = screen.getByLabelText("Resume PDF");
    await userEvent.upload(input, new File(["x"], "cv.docx", { type: "application/msword" }), {
      applyAccept: false,
    });

    expect(screen.getByText("Only PDF files are supported.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload" })).toBeDisabled();
  });

  it("rejects files over 2MB before uploading", async () => {
    await userEvent.upload(screen.getByLabelText("Resume PDF"), pdf(2 * 1024 * 1024 + 1));

    expect(screen.getByText("The file must be 2MB or smaller.")).toBeInTheDocument();
  });

  it("shows upload errors and allows a retry", async () => {
    vi.mocked(uploadResumeAction)
      .mockResolvedValueOnce({ error: "Insufficient AI credits for resume upload." })
      .mockResolvedValueOnce({ success: true, resumeId: "r9" });

    await userEvent.upload(screen.getByLabelText("Resume PDF"), pdf());
    await userEvent.click(screen.getByRole("button", { name: "Upload" }));

    expect(screen.getByText("Insufficient AI credits for resume upload.")).toBeInTheDocument();
    expect(onComplete).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Upload" }));
    expect(onComplete).toHaveBeenCalledWith({ resumeId: "r9" });
  });

  it("reports a cancellation", async () => {
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onComplete).toHaveBeenCalledWith({ cancelled: true });
  });
});
