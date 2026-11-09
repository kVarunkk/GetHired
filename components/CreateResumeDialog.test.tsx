import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createResumeAction } from "@/app/actions/resumes/create-resume";
import CreateResumeDialog from "./CreateResumeDialog";

const push = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("react-transition-progress", () => ({ useProgress: () => vi.fn() }));
vi.mock("swr", () => ({ default: () => ({ data: undefined }) }));
vi.mock("react-hot-toast", () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/app/actions/resumes/create-resume", () => ({ createResumeAction: vi.fn() }));
vi.mock("@/app/actions/upload-resume-file", () => ({ uploadResumeAction: vi.fn() }));
vi.mock("./agent/AgentHandoff", () => ({ default: () => null }));
vi.mock("./ResumeSourceSelector", () => ({ default: () => null }));

const open = async () => {
  render(<CreateResumeDialog />);
  fireEvent.click(screen.getByRole("button", { name: "New resume" }));
  return screen.findByRole("button", { name: "Start blank" });
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("New resume (RE-REQ-030)", () => {
  it("starts blank, and opens the editor", async () => {
    vi.mocked(createResumeAction).mockResolvedValue({ ok: true, resumeId: "r1" });

    fireEvent.click(await open());

    await waitFor(() => expect(push).toHaveBeenCalledWith("/resume/r1/edit"));
  });

  it("shows why it couldn't, and stays open", async () => {
    vi.mocked(createResumeAction).mockResolvedValue({ ok: false, error: "You can have up to 50 resumes." });

    fireEvent.click(await open());

    expect(await screen.findByRole("alert")).toHaveTextContent("You can have up to 50 resumes.");
    expect(push).not.toHaveBeenCalled();
  });
});
