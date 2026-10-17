import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import toast from "react-hot-toast";
import { createClient } from "@/lib/supabase/client";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import EmailPreferences from "./EmailPreferences";

vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn() }));
vi.mock("react-hot-toast", () => ({ default: { success: vi.fn(), error: vi.fn() } }));

const USER_ID = "a0000000-0000-4000-8000-000000000001";

let supabase: SupabaseMock;

const digest = () => screen.getByRole("switch", { name: /job digest/i });
const promotions = () => screen.getByRole("switch", { name: /product updates/i });

beforeEach(() => {
  vi.clearAllMocks();
  supabase = createSupabaseMock();
  vi.mocked(createClient).mockReturnValue(supabase.client);
});

describe("EmailPreferences", () => {
  it("shows the saved subscriptions", () => {
    render(<EmailPreferences userId={USER_ID} initialJobDigest initialPromotions={false} />);

    expect(digest()).toHaveAttribute("aria-checked", "true");
    expect(promotions()).toHaveAttribute("aria-checked", "false");
  });

  it.each([
    ["job digest", digest, "is_job_digest_active"],
    ["product updates", promotions, "is_promotion_active"],
  ])("saves the %s switch for the user", async (_name, getSwitch, column) => {
    render(<EmailPreferences userId={USER_ID} initialJobDigest={false} initialPromotions={false} />);

    fireEvent.click(getSwitch());

    await waitFor(() => expect(supabase.callsFor("user_info")).toHaveLength(1));
    const [update] = supabase.callsFor("user_info");
    expect(update.chain).toContainEqual({ method: "update", args: [{ [column]: true }] });
    expect(update.chain).toContainEqual({ method: "eq", args: ["user_id", USER_ID] });
    expect(getSwitch()).toHaveAttribute("aria-checked", "true");
  });

  it("rolls back and says so when saving fails", async () => {
    supabase.queue("user_info", { data: null, error: { message: "boom" } });
    render(<EmailPreferences userId={USER_ID} initialJobDigest initialPromotions={false} />);

    fireEvent.click(digest());

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(digest()).toHaveAttribute("aria-checked", "true");
  });
});
