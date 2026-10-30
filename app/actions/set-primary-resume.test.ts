import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@/lib/supabase/server";
import { eventCaptureServerException } from "@/helpers/posthog/EventCaptureServerException";
import { updateUserEmbedding } from "@/helpers/user/update-user-embedding";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { setPrimaryResumeAction } from "./set-primary-resume";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/helpers/user/update-user-embedding", () => ({ updateUserEmbedding: vi.fn() }));
vi.mock("@/helpers/posthog/EventCaptureServerException", () => ({
  eventCaptureServerException: vi.fn(),
}));

const USER_ID = "00000000-0000-4000-8000-000000000001";
const RESUME_ID = "22222222-2222-4222-8222-222222222222";

let supabase: SupabaseMock;

function signIn(user: { id: string } | null) {
  supabase = createSupabaseMock({ user });
  vi.mocked(createClient).mockResolvedValue(supabase.client);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(updateUserEmbedding).mockResolvedValue({ error: null } as never);
  signIn({ id: USER_ID });
});

describe("setPrimaryResumeAction", () => {
  it("refuses without a session", async () => {
    signIn(null);

    expect(await setPrimaryResumeAction(RESUME_ID)).toEqual({
      success: false,
      error: "Unauthorized access.",
    });
    expect(supabase.calls).toHaveLength(0);
  });

  it("clears the user's primary resume, sets the new one and re-embeds the profile", async () => {
    expect(await setPrimaryResumeAction(RESUME_ID)).toEqual({ success: true });

    const [clear, set] = supabase.callsFor("resumes");
    expect(clear.chain).toEqual([
      { method: "update", args: [{ is_primary: false }] },
      { method: "eq", args: ["user_id", USER_ID] },
    ]);
    expect(set.chain).toEqual([
      { method: "update", args: [{ is_primary: true }] },
      { method: "eq", args: ["id", RESUME_ID] },
      { method: "eq", args: ["user_id", USER_ID] },
    ]);
    expect(updateUserEmbedding).toHaveBeenCalledWith(USER_ID);
  });

  it("returns and reports a database error", async () => {
    supabase.queue("resumes", { data: null, error: new Error("update failed") });

    expect(await setPrimaryResumeAction(RESUME_ID)).toEqual({
      success: false,
      error: "update failed",
    });
    expect(supabase.callsFor("resumes")).toHaveLength(1);
    expect(eventCaptureServerException).toHaveBeenCalledWith(
      expect.objectContaining({
        distinctId: USER_ID,
        properties: { flow: "set_primary_resume", resume_id: RESUME_ID },
      }),
    );
  });

  it("returns an error when the embedding update fails", async () => {
    vi.mocked(updateUserEmbedding).mockResolvedValue({ error: "boom" } as never);

    expect(await setPrimaryResumeAction(RESUME_ID)).toEqual({
      success: false,
      error: "Background Embedding Failed",
    });
  });
});
