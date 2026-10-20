import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { setProfileVisibilityAction } from "@/app/actions/user/set-profile-visibility";
import PrivacySettings from "./PrivacySettings";

vi.mock("@/app/actions/user/set-profile-visibility", () => ({ setProfileVisibilityAction: vi.fn() }));
vi.mock("@/app/actions/outreach/set-outreach-preferences", () => ({
  setOutreachPreferencesAction: vi.fn(),
  unblockCompanyAction: vi.fn(),
}));
vi.mock("react-hot-toast", () => ({ default: { success: vi.fn(), error: vi.fn() } }));

const visibility = () => screen.getByRole("switch", { name: /public profile/i });
const outreach = () => screen.getByRole("switch", { name: /accept outreach/i });

function renderSettings(isPublic: boolean) {
  render(
    <PrivacySettings
      initialIsPublic={isPublic}
      initialAcceptsOutreach
      initialBlocked={[]}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(setProfileVisibilityAction).mockResolvedValue({ ok: true });
});

describe("PrivacySettings", () => {
  it("turns outreach off and disables it when the profile is hidden", async () => {
    renderSettings(true);
    expect(outreach()).toBeEnabled();
    expect(outreach()).toHaveAttribute("aria-checked", "true");

    fireEvent.click(visibility());

    expect(outreach()).toBeDisabled();
    expect(outreach()).toHaveAttribute("aria-checked", "false");
    await waitFor(() => expect(setProfileVisibilityAction).toHaveBeenCalled());
  });

  it("enables outreach when the profile is made public", async () => {
    renderSettings(false);
    expect(outreach()).toBeDisabled();

    fireEvent.click(visibility());

    expect(outreach()).toBeEnabled();
    await waitFor(() => expect(setProfileVisibilityAction).toHaveBeenCalled());
  });

  it("puts outreach back when hiding the profile fails", async () => {
    vi.mocked(setProfileVisibilityAction).mockResolvedValue({ ok: false, error: "boom" });
    renderSettings(true);

    fireEvent.click(visibility());

    await waitFor(() => expect(visibility()).toHaveAttribute("aria-checked", "true"));
    expect(outreach()).toBeEnabled();
  });
});
