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
  vi.clearAllMocks();
  onComplete = vi.fn();
  render(<ResumeUploadWidget reason="so I can review it" onComplete={onComplete} />);
});

describe("ResumeUploadWidget", () => {
  it("uploads a PDF and reports the new resume id", async () => {
    vi.mocked(uploadResumeAction).mockResolvedValue({ success: true, resumeId: "r9" });

    await userEvent.upload(screen.getByLabelText("Resume file"), pdf());
    await userEvent.click(screen.getByRole("button", { name: "Upload" }));

    const formData = vi.mocked(uploadResumeAction).mock.calls[0][0];
    expect((formData.get("file") as File).name).toBe("cv.pdf");
    expect(onComplete).toHaveBeenCalledWith({ resumeId: "r9" });
  });

  it("uploads a Word file", async () => {
    vi.mocked(uploadResumeAction).mockResolvedValue({ success: true, resumeId: "r9" });

    await userEvent.upload(screen.getByLabelText("Resume file"), new File(["x"], "cv.docx"), { applyAccept: false });
    await userEvent.click(screen.getByRole("button", { name: "Upload" }));

    expect(onComplete).toHaveBeenCalledWith({ resumeId: "r9" });
  });

  it("disables upload until a file is chosen", () => {
    expect(screen.getByRole("button", { name: "Upload" })).toBeDisabled();
  });

  it("rejects other files before uploading", async () => {
    const input = screen.getByLabelText("Resume file");
    await userEvent.upload(input, new File(["x"], "cv.txt", { type: "text/plain" }), {
      applyAccept: false,
    });

    expect(screen.getByText("Upload a PDF or Word (.docx) file.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload" })).toBeDisabled();
  });

  it("rejects files over 2MB before uploading", async () => {
    await userEvent.upload(screen.getByLabelText("Resume file"), pdf(2 * 1024 * 1024 + 1));

    expect(screen.getByText("The file must be 2 MB or smaller.")).toBeInTheDocument();
  });

  it("shows upload errors and allows a retry", async () => {
    vi.mocked(uploadResumeAction)
      .mockResolvedValueOnce({ error: "Insufficient AI credits for resume upload." })
      .mockResolvedValueOnce({ success: true, resumeId: "r9" });

    await userEvent.upload(screen.getByLabelText("Resume file"), pdf());
    await userEvent.click(screen.getByRole("button", { name: "Upload" }));

    expect(screen.getByText("Insufficient AI credits for resume upload.")).toBeInTheDocument();
    expect(onComplete).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Upload" }));
    expect(onComplete).toHaveBeenCalledWith({ resumeId: "r9" });
  });

  it("shows progress and can't be started twice", async () => {
    let finish: (value: { success: boolean; resumeId: string }) => void = () => {};
    vi.mocked(uploadResumeAction).mockReturnValue(new Promise((resolve) => (finish = resolve)));

    await userEvent.upload(screen.getByLabelText("Resume file"), pdf());
    await userEvent.dblClick(screen.getByRole("button", { name: "Upload" }));

    expect(screen.getByRole("button", { name: /Reading your resume/ })).toBeDisabled();
    expect(uploadResumeAction).toHaveBeenCalledTimes(1);
    finish({ success: true, resumeId: "r9" });
    await vi.waitFor(() => expect(onComplete).toHaveBeenCalled());
  });

  it("reports a cancellation", async () => {
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onComplete).toHaveBeenCalledWith({ cancelled: true });
  });
});
