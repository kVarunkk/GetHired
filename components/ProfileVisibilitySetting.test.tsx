import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import toast from "react-hot-toast";
import { setProfileVisibilityAction } from "@/app/actions/user/set-profile-visibility";
import ProfileVisibilitySetting from "./ProfileVisibilitySetting";

vi.mock("@/app/actions/user/set-profile-visibility", () => ({ setProfileVisibilityAction: vi.fn() }));
vi.mock("react-hot-toast", () => ({ default: { success: vi.fn(), error: vi.fn() } }));

const toggle = () => screen.getByRole("switch", { name: /public profile/i });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(setProfileVisibilityAction).mockResolvedValue({ ok: true });
});

describe("ProfileVisibilitySetting (spec §3.6)", () => {
  it.each([
    [true, "Public"],
    [false, "Hidden"],
  ])("shows the current visibility (is_public = %s)", (isPublic, status) => {
    render(<ProfileVisibilitySetting initialIsPublic={isPublic} />);

    expect(toggle()).toHaveAttribute("aria-checked", String(isPublic));
    expect(screen.getByText(status)).toBeInTheDocument();
    expect(toggle()).toHaveAccessibleDescription(expect.stringMatching(/from your resume/));
  });

  it("saves the change through the server action", async () => {
    render(<ProfileVisibilitySetting initialIsPublic={true} />);

    fireEvent.click(toggle());

    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    expect(setProfileVisibilityAction).toHaveBeenCalledWith({ isPublic: false });
    expect(toggle()).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("Hidden")).toBeInTheDocument();
  });

  it("rolls back and shows an error when saving fails", async () => {
    vi.mocked(setProfileVisibilityAction).mockResolvedValue({ ok: false, error: "denied" });
    render(<ProfileVisibilitySetting initialIsPublic={true} />);

    fireEvent.click(toggle());

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toggle()).toHaveAttribute("aria-checked", "true");
    expect(toggle()).toBeEnabled();
  });
});
