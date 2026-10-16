import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import toast from "react-hot-toast";
import { createClient } from "@/lib/supabase/client";
import { revalidateCacheAction } from "@/app/actions/revalidate-tag";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import ProfileVisibilitySetting from "./ProfileVisibilitySetting";

vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn() }));
vi.mock("@/app/actions/revalidate-tag", () => ({ revalidateCacheAction: vi.fn() }));
vi.mock("react-hot-toast", () => ({ default: { success: vi.fn(), error: vi.fn() } }));

const USER_ID = "a0000000-0000-4000-8000-000000000001";

let supabase: SupabaseMock;

const toggle = () => screen.getByRole("switch", { name: /public profile/i });

beforeEach(() => {
  vi.clearAllMocks();
  supabase = createSupabaseMock();
  vi.mocked(createClient).mockReturnValue(supabase.client);
  vi.mocked(revalidateCacheAction).mockResolvedValue({ success: true });
});

describe("ProfileVisibilitySetting (spec §3.6)", () => {
  it.each([
    [true, "Public"],
    [false, "Hidden"],
  ])("shows the current visibility (is_public = %s)", (isPublic, status) => {
    render(<ProfileVisibilitySetting userId={USER_ID} initialIsPublic={isPublic} />);

    expect(toggle()).toHaveAttribute("aria-checked", String(isPublic));
    expect(screen.getByText(status)).toBeInTheDocument();
    expect(toggle()).toHaveAccessibleDescription(expect.stringMatching(/from your resume/));
  });

  it("saves the change and refreshes the cached profile", async () => {
    render(<ProfileVisibilitySetting userId={USER_ID} initialIsPublic={true} />);

    fireEvent.click(toggle());

    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    const [update] = supabase.callsFor("user_info");
    expect(update.chain).toContainEqual({ method: "update", args: [{ is_public: false }] });
    expect(update.chain).toContainEqual({ method: "eq", args: ["user_id", USER_ID] });
    expect(revalidateCacheAction).toHaveBeenCalledWith(`profile-${USER_ID}`);
    expect(toggle()).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("Hidden")).toBeInTheDocument();
  });

  it("rolls back and shows an error when saving fails", async () => {
    supabase.queue("user_info", { data: null, error: { message: "denied" } });
    render(<ProfileVisibilitySetting userId={USER_ID} initialIsPublic={true} />);

    fireEvent.click(toggle());

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toggle()).toHaveAttribute("aria-checked", "true");
    expect(revalidateCacheAction).not.toHaveBeenCalled();
    expect(toggle()).toBeEnabled();
  });
});
