import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { uploadResumeAction } from "@/app/actions/upload-resume-file";
import ResumeReuploadPrompt from "./ResumeReuploadPrompt";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("react-hot-toast", () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/app/actions/upload-resume-file", () => ({ uploadResumeAction: vi.fn() }));

const RESUME = { id: "22222222-2222-4222-8222-222222222222", name: "Backend" };

const pdf = ({ name = "cv.pdf", type = "application/pdf", size }: { name?: string; type?: string; size?: number } = {}) => {
  const file = new File(["%PDF-1.4"], name, { type });
  if (size !== undefined) Object.defineProperty(file, "size", { value: size });
  return file;
};

const errorText = () => document.querySelector("p[role='alert']");

const choose = (file: File) =>
  fireEvent.change(screen.getByLabelText("Resume file"), { target: { files: [file] } });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(uploadResumeAction).mockResolvedValue({ success: true, resumeId: RESUME.id });
});

describe("ResumeReuploadPrompt (RE-REQ-098, RE-REQ-103)", () => {
  it("names the resume it asks about", () => {
    render(<ResumeReuploadPrompt resume={RESUME} />);

    expect(screen.getByText("Upload Backend again")).toBeInTheDocument();
    expect(screen.getByText(/keep its reviews and applications/)).toBeInTheDocument();
  });

  it("says nothing when there's no resume to ask about", () => {
    const { container } = render(<ResumeReuploadPrompt resume={null} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("replaces the same resume, so its reviews still point at it", async () => {
    render(<ResumeReuploadPrompt resume={RESUME} />);

    choose(pdf());
    await waitFor(() => expect(refresh).toHaveBeenCalled());

    expect(uploadResumeAction).toHaveBeenCalledTimes(1);
    const formData = vi.mocked(uploadResumeAction).mock.calls[0][0] as FormData;
    expect(formData.get("replaceResumeId")).toBe(RESUME.id);
    expect(formData.get("file")).toBeInstanceOf(File);
  });

  it("refuses a file that's too big, before reading it", async () => {
    render(<ResumeReuploadPrompt resume={RESUME} />);

    choose(pdf({ size: 3 * 1024 * 1024 }));

    expect(errorText()).toHaveTextContent("2 MB or smaller");
    expect(uploadResumeAction).not.toHaveBeenCalled();
  });

  it("refuses a type it can't read", async () => {
    render(<ResumeReuploadPrompt resume={RESUME} />);

    choose(pdf({ name: "cv.txt", type: "text/plain" }));

    expect(errorText()).toHaveTextContent("PDF or Word");
    expect(uploadResumeAction).not.toHaveBeenCalled();
  });

  it("shows the server's reason when the upload fails, and stays put", async () => {
    vi.mocked(uploadResumeAction).mockResolvedValue({ error: "That file isn't a resume." });
    render(<ResumeReuploadPrompt resume={RESUME} />);

    choose(pdf());
    await waitFor(() => expect(errorText()).toHaveTextContent("That file isn't a resume."));
    expect(refresh).not.toHaveBeenCalled();
  });

  it("never leaves the user without an error when the action throws", async () => {
    vi.mocked(uploadResumeAction).mockRejectedValue(new Error("network"));
    render(<ResumeReuploadPrompt resume={RESUME} />);

    choose(pdf());
    await waitFor(() => expect(errorText()).toHaveTextContent("Upload failed"));
  });
});
