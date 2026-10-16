import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import toast from "react-hot-toast";
import { createClient } from "@/lib/supabase/client";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import UserOnboardingPersonalization from "./UserOnboardingPersonalization";

vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn() }));
vi.mock("react-hot-toast", () => ({ default: { success: vi.fn(), error: vi.fn() } }));

const USER_ID = "a0000000-0000-4000-8000-000000000001";

let supabase: SupabaseMock;

function renderPreferences(isPublic = true) {
  render(
    <UserOnboardingPersonalization
      disabled={false}
      initialPreferences={{
        id: USER_ID,
        is_promotion_active: false,
        is_job_digest_active: false,
        is_public: isPublic,
      }}
    />,
  );
  // The preferences live in a collapsed accordion.
  fireEvent.click(screen.getByRole("button", { name: "Preferences" }));
  return screen.getByRole("checkbox", { name: /public profile/i });
}

beforeEach(() => {
  vi.clearAllMocks();
  supabase = createSupabaseMock();
  vi.mocked(createClient).mockReturnValue(supabase.client);
});

describe("UserOnboardingPersonalization profile visibility (spec §3.6)", () => {
  it("explains exactly what recruiters see and that it can be hidden", () => {
    const checkbox = renderPreferences();

    expect(checkbox).toHaveAccessibleDescription(
      expect.stringMatching(
        /name, desired roles, skills, experience, location and salary preferences, and the experience, skills, projects and education from your resume/,
      ),
    );
    expect(checkbox).toHaveAccessibleDescription(expect.stringMatching(/email, LinkedIn, GitHub and resume file are shared only with companies you apply to/));
    expect(checkbox).toHaveAccessibleDescription(expect.stringMatching(/companies you apply to/i));
    expect(checkbox).toHaveAccessibleDescription(expect.stringMatching(/hide your profile at any time/));
  });

  it("saves is_public for the user when toggled", async () => {
    const checkbox = renderPreferences(true);

    fireEvent.click(checkbox);

    await waitFor(() => expect(supabase.callsFor("user_info")).toHaveLength(1));
    const [update] = supabase.callsFor("user_info");
    expect(update.chain).toContainEqual({ method: "update", args: [{ is_public: false }] });
    expect(update.chain).toContainEqual({ method: "eq", args: ["user_id", USER_ID] });
  });

  it("rolls back and tells the user when saving fails", async () => {
    supabase.queue("user_info", { data: null, error: { message: "denied" } });
    const checkbox = renderPreferences(true);

    fireEvent.click(checkbox);

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(checkbox).toBeChecked();
  });
});
