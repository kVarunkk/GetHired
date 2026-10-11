import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@/lib/supabase/server";
import { setUserAppMetadata } from "@/helpers/user/set-app-metadata";
import { createSupabaseMock } from "@/test/utils/supabase-mock";
import * as actions from "./update-user-metadata";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/helpers/user/set-app-metadata", () => ({ setUserAppMetadata: vi.fn() }));
vi.mock("@/helpers/posthog/EventCaptureServerException", () => ({
  eventCaptureServerException: vi.fn(),
}));

const SESSION_USER_ID = "00000000-0000-4000-8000-000000000001";

/** Signs in a user with the given app_metadata, or signs out with null. */
function signIn(appMetadata: Record<string, unknown> | null) {
  const supabase = createSupabaseMock({
    user: appMetadata ? { id: SESSION_USER_ID, app_metadata: appMetadata } : null,
  });
  vi.mocked(createClient).mockResolvedValue(supabase.client);
}

beforeEach(() => {
  vi.mocked(setUserAppMetadata).mockResolvedValue({ error: null });
});

describe("update-user-metadata server actions (SEC-008)", () => {
  it("no longer exports an action that writes any user's metadata", () => {
    expect(Object.keys(actions)).toEqual(["markMyOnboardingComplete"]);
  });
});

describe("markMyOnboardingComplete", () => {
  it("marks the signed-in user's onboarding complete", async () => {
    signIn({ type: "applicant", onboarding_complete: false });

    expect(await actions.markMyOnboardingComplete("applicant")).toEqual({ error: null });
    expect(setUserAppMetadata).toHaveBeenCalledWith(SESSION_USER_ID, {
      type: "applicant",
      onboarding_complete: true,
    });
  });

  it("works for a company account too", async () => {
    signIn({ type: "company", onboarding_complete: false });

    await actions.markMyOnboardingComplete("company");

    expect(setUserAppMetadata).toHaveBeenCalledWith(SESSION_USER_ID, {
      type: "company",
      onboarding_complete: true,
    });
  });

  it("lets a user without a type yet choose one", async () => {
    signIn({});

    await actions.markMyOnboardingComplete("company");

    expect(setUserAppMetadata).toHaveBeenCalledWith(SESSION_USER_ID, {
      type: "company",
      onboarding_complete: true,
    });
  });

  it("refuses to change an existing account type", async () => {
    signIn({ type: "applicant", onboarding_complete: true });

    expect(await actions.markMyOnboardingComplete("company")).toEqual({
      error: "You can't change your account type.",
    });
    expect(setUserAppMetadata).not.toHaveBeenCalled();
  });

  it("rejects anything but the two account types", async () => {
    signIn({});

    expect(await actions.markMyOnboardingComplete("admin" as never)).toEqual({
      error: "Invalid account type.",
    });
    expect(setUserAppMetadata).not.toHaveBeenCalled();
  });

  it("requires a signed-in user", async () => {
    signIn(null);

    expect(await actions.markMyOnboardingComplete("applicant")).toEqual({
      error: "Authentication required.",
    });
    expect(setUserAppMetadata).not.toHaveBeenCalled();
  });

  it("passes on errors from the metadata update", async () => {
    signIn({ type: "applicant" });
    vi.mocked(setUserAppMetadata).mockResolvedValue({ error: "Error updating user metadata." });

    expect(await actions.markMyOnboardingComplete("applicant")).toEqual({
      error: "Error updating user metadata.",
    });
  });
});
