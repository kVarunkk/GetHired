import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { upgradeResumeAction } from "@/app/actions/resumes/upgrade-resume";
import { uploadResumeAction } from "@/app/actions/upload-resume-file";
import ResumeUpgradeGate from "./ResumeUpgradeGate";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/app/actions/resumes/upgrade-resume", () => ({ upgradeResumeAction: vi.fn() }));
vi.mock("@/app/actions/upload-resume-file", () => ({ uploadResumeAction: vi.fn() }));

const pdf = (size = 10) => new File([new Uint8Array(size)], "cv.pdf", { type: "application/pdf" });

const choose = (file: File) => fireEvent.change(screen.getByLabelText("Resume file"), { target: { files: [file] } });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(upgradeResumeAction).mockResolvedValue({ ok: true });
  vi.mocked(uploadResumeAction).mockResolvedValue({ success: true, resumeId: "r1" });
});

describe("ResumeUpgradeGate (RE-REQ-095)", () => {
  it("shows progress, upgrades once, and refreshes into the editor", async () => {
    render(<ResumeUpgradeGate resumeId="r1" />);

    expect(screen.getByRole("status")).toHaveTextContent(/Updating this resume/);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(upgradeResumeAction).toHaveBeenCalledTimes(1);
    expect(upgradeResumeAction).toHaveBeenCalledWith({ resumeId: "r1" });
  });

  it("offers a re-upload when the upgrade fails", async () => {
    vi.mocked(upgradeResumeAction).mockResolvedValue({ ok: false, error: "Upload it again." });
    render(<ResumeUpgradeGate resumeId="r1" />);

    expect(await screen.findByText("Upload it again.")).toBeInTheDocument();
    expect(screen.getByLabelText("Resume file")).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("offers it when the action throws too", async () => {
    vi.mocked(upgradeResumeAction).mockRejectedValue(new Error("offline"));
    render(<ResumeUpgradeGate resumeId="r1" />);

    expect(await screen.findByLabelText("Resume file")).toBeInTheDocument();
  });

  describe("the re-upload", () => {
    beforeEach(() => {
      vi.mocked(upgradeResumeAction).mockResolvedValue({ ok: false, error: "Upload it again." });
    });

    it("replaces this resume, and refreshes into the editor", async () => {
      render(<ResumeUpgradeGate resumeId="r1" />);
      await screen.findByLabelText("Resume file");

      choose(pdf());

      await waitFor(() => expect(refresh).toHaveBeenCalled());
      const formData = vi.mocked(uploadResumeAction).mock.calls[0][0];
      expect(formData.get("replaceResumeId")).toBe("r1");
      expect((formData.get("file") as File).name).toBe("cv.pdf");
    });

    it("refuses a file it can't take, before sending it", async () => {
      render(<ResumeUpgradeGate resumeId="r1" />);
      await screen.findByLabelText("Resume file");

      choose(new File(["x"], "cv.txt", { type: "text/plain" }));

      expect(await screen.findByText(/Upload a PDF or Word/)).toBeInTheDocument();
      expect(uploadResumeAction).not.toHaveBeenCalled();
    });

    it("shows a failed upload", async () => {
      vi.mocked(uploadResumeAction).mockResolvedValue({ error: "We couldn't read this file." });
      render(<ResumeUpgradeGate resumeId="r1" />);
      await screen.findByLabelText("Resume file");

      choose(pdf());

      expect(await screen.findByText("We couldn't read this file.")).toBeInTheDocument();
    });
  });
});
