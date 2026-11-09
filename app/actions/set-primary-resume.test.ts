import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { eventCaptureServerException } from "@/helpers/posthog/EventCaptureServerException";
import { refreshProfileAfterChange } from "@/helpers/user/queue-profile-refresh";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { setPrimaryResumeAction } from "./set-primary-resume";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/helpers/user/queue-profile-refresh", () => ({ refreshProfileAfterChange: vi.fn() }));
vi.mock("@/helpers/posthog/EventCaptureServerException", () => ({
  eventCaptureServerException: vi.fn(),
}));

const USER_ID = "00000000-0000-4000-8000-000000000001";
const RESUME_ID = "22222222-2222-4222-8222-222222222222";

let supabase: SupabaseMock;
let service: SupabaseMock;

function signIn(user: { id: string } | null) {
  supabase = createSupabaseMock({ user });
  vi.mocked(createClient).mockResolvedValue(supabase.client);
}

beforeEach(() => {
  vi.clearAllMocks();
  service = createSupabaseMock();
  vi.mocked(createServiceRoleClient).mockReturnValue(service.client);
  vi.mocked(refreshProfileAfterChange).mockResolvedValue("queued");
  signIn({ id: USER_ID });
});

describe("setPrimaryResumeAction", () => {
  it("refuses without a session", async () => {
    signIn(null);

    expect(await setPrimaryResumeAction(RESUME_ID)).toEqual({
      success: false,
      error: "Unauthorized access.",
    });
    expect(service.calls).toHaveLength(0);
  });

  it("swaps the primary in one call for the session user, then refreshes the embedding and matches", async () => {
    service.queueRpc("set_primary_resume", { data: { ok: true, changed: true }, error: null });

    expect(await setPrimaryResumeAction(RESUME_ID)).toEqual({ success: true, refresh: "queued" });
    expect(service.calls).toHaveLength(1);
    expect(service.callsFor("set_primary_resume")[0].chain[0].args[1]).toEqual({
      p_user_id: USER_ID,
      p_resume_id: RESUME_ID,
    });
    expect(refreshProfileAfterChange).toHaveBeenCalledWith(USER_ID);
  });

  it("starts no refresh when it was already the primary", async () => {
    service.queueRpc("set_primary_resume", { data: { ok: true, changed: false }, error: null });

    expect(await setPrimaryResumeAction(RESUME_ID)).toEqual({ success: true, refresh: "unchanged" });
    expect(refreshProfileAfterChange).not.toHaveBeenCalled();
  });

  it("refuses a resume that isn't the user's", async () => {
    service.queueRpc("set_primary_resume", { data: { ok: false, reason: "resume_not_found" }, error: null });

    expect(await setPrimaryResumeAction(RESUME_ID)).toEqual({ success: false, error: "Resume not found." });
    expect(refreshProfileAfterChange).not.toHaveBeenCalled();
  });

  it("returns and reports a database error", async () => {
    service.queueRpc("set_primary_resume", { data: null, error: new Error("update failed") });

    expect(await setPrimaryResumeAction(RESUME_ID)).toEqual({
      success: false,
      error: "Could not update the primary resume. Please try again.",
    });
    expect(eventCaptureServerException).toHaveBeenCalledWith(
      expect.objectContaining({
        distinctId: USER_ID,
        properties: { flow: "set_primary_resume", resume_id: RESUME_ID },
      }),
    );
  });
});
