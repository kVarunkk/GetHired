import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import toast from "react-hot-toast";
import { setEmailPreferenceAction } from "@/app/actions/user/set-email-preference";
import EmailPreferences from "./EmailPreferences";

vi.mock("@/app/actions/user/set-email-preference", () => ({ setEmailPreferenceAction: vi.fn() }));
vi.mock("react-hot-toast", () => ({ default: { success: vi.fn(), error: vi.fn() } }));

const digest = () => screen.getByRole("switch", { name: /job digest/i });
const promotions = () => screen.getByRole("switch", { name: /product updates/i });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(setEmailPreferenceAction).mockResolvedValue({ ok: true });
});

describe("EmailPreferences", () => {
  it("shows the saved subscriptions", () => {
    render(<EmailPreferences initialJobDigest initialPromotions={false} />);

    expect(digest()).toHaveAttribute("aria-checked", "true");
    expect(promotions()).toHaveAttribute("aria-checked", "false");
  });

  it.each([
    ["job digest", digest, "is_job_digest_active"],
    ["product updates", promotions, "is_promotion_active"],
  ])("saves the %s switch through the server action", async (_name, getSwitch, key) => {
    render(<EmailPreferences initialJobDigest={false} initialPromotions={false} />);

    fireEvent.click(getSwitch());

    await waitFor(() => expect(setEmailPreferenceAction).toHaveBeenCalledWith({ key, value: true }));
    expect(getSwitch()).toHaveAttribute("aria-checked", "true");
  });

  it("rolls back and says so when saving fails", async () => {
    vi.mocked(setEmailPreferenceAction).mockResolvedValue({ ok: false, error: "boom" });
    render(<EmailPreferences initialJobDigest initialPromotions={false} />);

    fireEvent.click(digest());

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(digest()).toHaveAttribute("aria-checked", "true");
  });
});
