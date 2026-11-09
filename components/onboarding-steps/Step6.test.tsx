import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { uploadResumeAction } from "@/app/actions/upload-resume-file";
import type { IFormData } from "../OnboardingComponent";
import { Step6ResumeUpload } from "./Step6";

vi.mock("@/app/actions/upload-resume-file", () => ({ uploadResumeAction: vi.fn() }));
vi.mock("swr", () => ({ default: () => ({ data: { profile: { resumes: [] } }, isLoading: false }) }));

let onFileChange: (file: File | null) => void;
vi.mock("../ResumeSourceSelector", () => ({
  default: (props: { onFileChange: typeof onFileChange }) => {
    onFileChange = props.onFileChange;
    return <div>selector</div>;
  },
}));

let form: IFormData;

function Harness({ initial }: { initial?: Partial<IFormData> }) {
  const [formData, setFormData] = useState({
    resume_file: null,
    resume_id: null,
    uploaded_resume_id: null,
    resume_parsing: false,
    claim_resume_name: null,
    use_claim_resume: false,
    ...initial,
  } as IFormData);
  form = formData;
  return <Step6ResumeUpload formData={formData} setFormData={setFormData} errors={{}} setErrors={() => {}} />;
}

const pdf = (name = "cv.pdf") => new File([new Uint8Array(4)], name);
const sentFile = (call = 0) => vi.mocked(uploadResumeAction).mock.calls[call][0];

beforeEach(() => vi.clearAllMocks());

describe("Step 6 resume upload (RE-REQ-021)", () => {
  it("parses when a file is added and keeps the resume id", async () => {
    vi.mocked(uploadResumeAction).mockResolvedValue({ success: true, resumeId: "r1" });
    render(<Harness />);

    await act(async () => onFileChange(pdf()));

    expect((sentFile().get("file") as File).name).toBe("cv.pdf");
    expect(sentFile().get("replaceResumeId")).toBeNull();
    expect(form).toMatchObject({ resume_id: "r1", uploaded_resume_id: "r1", resume_parsing: false });
    expect(form.resume_file?.name).toBe("cv.pdf");
  });

  it("shows progress and hides the selector while reading", async () => {
    let finish: (value: { success: boolean; resumeId: string }) => void = () => {};
    vi.mocked(uploadResumeAction).mockReturnValue(new Promise((resolve) => (finish = resolve)));
    render(<Harness />);

    await act(async () => onFileChange(pdf()));

    expect(screen.getByText(/Reading your resume/)).toBeInTheDocument();
    expect(screen.queryByText("selector")).not.toBeInTheDocument();
    expect(form.resume_parsing).toBe(true);
    expect(form.resume_id).toBeNull();

    await act(async () => finish({ success: true, resumeId: "r1" }));
    expect(screen.getByText("selector")).toBeInTheDocument();
  });

  it("shows a failure in place, with nothing picked, and lets them try again", async () => {
    vi.mocked(uploadResumeAction).mockResolvedValue({ error: "We couldn't read this file." });
    render(<Harness />);

    await act(async () => onFileChange(pdf()));

    expect(screen.getByRole("alert")).toHaveTextContent("We couldn't read this file.");
    expect(form).toMatchObject({ resume_id: null, resume_file: null, resume_parsing: false });

    vi.mocked(uploadResumeAction).mockResolvedValue({ success: true, resumeId: "r1" });
    await act(async () => onFileChange(pdf()));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(form.resume_id).toBe("r1");
  });

  it("survives the action throwing", async () => {
    vi.mocked(uploadResumeAction).mockRejectedValue(new Error("network"));
    render(<Harness />);

    await act(async () => onFileChange(pdf()));

    expect(screen.getByRole("alert")).toHaveTextContent("Upload failed. Please try again.");
    expect(form.resume_parsing).toBe(false);
  });

  it("replaces its own row when a new file comes in, so one is left", async () => {
    vi.mocked(uploadResumeAction).mockResolvedValue({ success: true, resumeId: "r1" });
    render(<Harness />);

    await act(async () => onFileChange(pdf("one.pdf")));
    await act(async () => onFileChange(pdf("two.pdf")));

    expect(sentFile(1).get("replaceResumeId")).toBe("r1");
    expect(form.resume_file?.name).toBe("two.pdf");
  });

  it("still replaces after going back and returning to the step", async () => {
    vi.mocked(uploadResumeAction).mockResolvedValue({ success: true, resumeId: "r1" });
    render(<Harness initial={{ uploaded_resume_id: "r1", resume_id: "r1" }} />);

    await act(async () => onFileChange(pdf()));

    expect(sentFile().get("replaceResumeId")).toBe("r1");
  });

  it("keeps the row to replace after a failed replace", async () => {
    vi.mocked(uploadResumeAction).mockResolvedValue({ error: "nope" });
    render(<Harness initial={{ uploaded_resume_id: "r1", resume_id: "r1" }} />);

    await act(async () => onFileChange(pdf()));

    expect(form.uploaded_resume_id).toBe("r1");
  });

  it("removing the file un-picks its resume", async () => {
    vi.mocked(uploadResumeAction).mockResolvedValue({ success: true, resumeId: "r1" });
    render(<Harness />);
    await act(async () => onFileChange(pdf()));

    await act(async () => onFileChange(null));

    expect(form).toMatchObject({ resume_file: null, resume_id: null, uploaded_resume_id: "r1" });
    expect(uploadResumeAction).toHaveBeenCalledTimes(1);
  });

  it("a cleared selection leaves a picked existing resume alone", async () => {
    render(<Harness initial={{ resume_id: "existing" }} />);

    await act(async () => onFileChange(null));

    expect(form.resume_id).toBe("existing");
  });

  it("choosing a file clears the claim's resume", async () => {
    vi.mocked(uploadResumeAction).mockResolvedValue({ success: true, resumeId: "r1" });
    render(<Harness initial={{ claim_resume_name: "Resume from Acme", use_claim_resume: true }} />);

    await act(async () => onFileChange(pdf()));

    expect(form.use_claim_resume).toBe(false);
  });
});
