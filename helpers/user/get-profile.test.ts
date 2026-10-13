import { beforeEach, describe, expect, it } from "vitest";
import { getProfile } from "./get-profile";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";

let supabase: SupabaseMock;

beforeEach(() => {
  supabase = createSupabaseMock();
});

describe("getProfile", () => {
  it("returns the profile summary for the given user", async () => {
    supabase.queue("user_info", {
      data: { full_name: "Ada", ai_credits: 7, filled: false, invitations_count: 0 },
      error: null,
    });

    const profile = await getProfile(supabase.client, { id: "u1", email: "ada@example.com" });

    expect(profile).toEqual({
      user_id: "u1",
      email: "ada@example.com",
      full_name: "Ada",
      ai_credits: 7,
      onboarding_complete: false,
      invitations_count: 0,
      metrics: {},
      recent_applications: [],
    });
  });

  it("throws database errors", async () => {
    supabase.queue("user_info", { data: null, error: new Error("boom") });

    await expect(getProfile(supabase.client, { id: "u1" })).rejects.toThrow("boom");
  });

  it("throws when the applications query fails", async () => {
    supabase.queue("user_info", { data: { full_name: "Ada" }, error: null });
    supabase.queue("applications", { data: null, error: new Error("apps down") });

    await expect(getProfile(supabase.client, { id: "u1" })).rejects.toThrow("apps down");
  });
});
