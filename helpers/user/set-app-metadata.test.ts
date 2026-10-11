import { beforeEach, describe, expect, it, vi } from "vitest";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { setUserAppMetadata } from "./set-app-metadata";

vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/helpers/posthog/EventCaptureServerException", () => ({
  eventCaptureServerException: vi.fn(),
}));

const USER_ID = "u1";
let admin: { getUserById: ReturnType<typeof vi.fn>; updateUserById: ReturnType<typeof vi.fn> };

beforeEach(() => {
  admin = {
    getUserById: vi.fn().mockResolvedValue({
      data: { user: { id: USER_ID, app_metadata: { provider: "email", type: "applicant" } } },
      error: null,
    }),
    updateUserById: vi.fn().mockResolvedValue({ error: null }),
  };
  vi.mocked(createServiceRoleClient).mockReturnValue({ auth: { admin } } as never);
});

describe("setUserAppMetadata (server only)", () => {
  it("merges the update into the user's existing app_metadata", async () => {
    expect(await setUserAppMetadata(USER_ID, { onboarding_complete: true })).toEqual({ error: null });

    expect(admin.updateUserById).toHaveBeenCalledWith(USER_ID, {
      app_metadata: { provider: "email", type: "applicant", onboarding_complete: true },
    });
  });

  it("returns an error when the user can't be read", async () => {
    admin.getUserById.mockResolvedValue({ data: { user: null }, error: new Error("nope") });

    expect(await setUserAppMetadata(USER_ID, { onboarding_complete: true })).toEqual({
      error: "Error retrieving User.",
    });
    expect(admin.updateUserById).not.toHaveBeenCalled();
  });

  it("returns an error when the update fails", async () => {
    admin.updateUserById.mockResolvedValue({ error: new Error("nope") });

    expect(await setUserAppMetadata(USER_ID, { onboarding_complete: true })).toEqual({
      error: "Error updating user metadata.",
    });
  });
});
