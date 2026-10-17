import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createClient } from "@/lib/supabase/client";
import { revalidateCacheAction } from "@/app/actions/revalidate-tag";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import PrivacySettings from "./PrivacySettings";

vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn() }));
vi.mock("@/app/actions/revalidate-tag", () => ({ revalidateCacheAction: vi.fn() }));
vi.mock("@/app/actions/outreach/set-outreach-preferences", () => ({
  setOutreachPreferencesAction: vi.fn(),
  unblockCompanyAction: vi.fn(),
}));
vi.mock("react-hot-toast", () => ({ default: { success: vi.fn(), error: vi.fn() } }));

const USER_ID = "a0000000-0000-4000-8000-000000000001";

let supabase: SupabaseMock;

const visibility = () => screen.getByRole("switch", { name: /public profile/i });
const outreach = () => screen.getByRole("switch", { name: /accept outreach/i });

function renderSettings(isPublic: boolean) {
  render(
    <PrivacySettings
      userId={USER_ID}
      initialIsPublic={isPublic}
      initialAcceptsOutreach
      initialBlocked={[]}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  supabase = createSupabaseMock();
  vi.mocked(createClient).mockReturnValue(supabase.client);
  vi.mocked(revalidateCacheAction).mockResolvedValue({ success: true });
});

describe("PrivacySettings", () => {
  it("turns outreach off and disables it when the profile is hidden", async () => {
    renderSettings(true);
    expect(outreach()).toBeEnabled();
    expect(outreach()).toHaveAttribute("aria-checked", "true");

    fireEvent.click(visibility());

    expect(outreach()).toBeDisabled();
    expect(outreach()).toHaveAttribute("aria-checked", "false");
    await waitFor(() => expect(revalidateCacheAction).toHaveBeenCalled());
  });

  it("enables outreach when the profile is made public", async () => {
    renderSettings(false);
    expect(outreach()).toBeDisabled();

    fireEvent.click(visibility());

    expect(outreach()).toBeEnabled();
    await waitFor(() => expect(revalidateCacheAction).toHaveBeenCalled());
  });

  it("puts outreach back when hiding the profile fails", async () => {
    supabase.queue("user_info", { data: null, error: { message: "boom" } });
    renderSettings(true);

    fireEvent.click(visibility());

    await waitFor(() => expect(visibility()).toHaveAttribute("aria-checked", "true"));
    expect(outreach()).toBeEnabled();
  });
});
