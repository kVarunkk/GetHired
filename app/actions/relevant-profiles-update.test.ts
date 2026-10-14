import { beforeEach, describe, expect, it, vi } from "vitest";
import { processJobPostingRelevance } from "@/helpers/profiles/relevant-profiles-utils";
import { eventCaptureServerException } from "@/helpers/posthog/EventCaptureServerException";
import { mockUser, setRequestUser } from "@/test/utils/auth";
import { afterCallbacks, flushAfter } from "@/test/utils/after";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A, jobPostingOf } from "@/test/utils/recruiter";
import { triggerJobPostingRelevanceUpdate } from "./relevant-profiles-update";

vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/helpers/profiles/relevant-profiles-utils", () => ({
  processJobPostingRelevance: vi.fn(),
}));
vi.mock("@/helpers/posthog/EventCaptureServerException", () => ({
  eventCaptureServerException: vi.fn(),
}));

const OWN = jobPostingOf(COMPANY_A);

let supabase: SupabaseMock;

const updatesOf = (status: string) =>
  supabase
    .callsFor("job_postings")
    .filter((c) =>
      c.chain.some(
        (m) => m.method === "update" && (m.args[0] as { matching_status?: string }).matching_status === status,
      ),
    );

async function signIn(user = COMPANY_A.user) {
  supabase = createSupabaseMock({ user });
  supabase.queue("company_info", { data: COMPANY_A.infoWithTier, error: null });
  await setRequestUser(user, supabase.client);
}

beforeEach(async () => {
  vi.clearAllMocks();
  await signIn();
  vi.mocked(processJobPostingRelevance).mockResolvedValue({ success: true });
});

describe("triggerJobPostingRelevanceUpdate", () => {
  it("refuses an unauthenticated caller", async () => {
    await setRequestUser(null, supabase.client);

    expect(await triggerJobPostingRelevanceUpdate(OWN.id)).toMatchObject({ success: false });
    expect(afterCallbacks).toHaveLength(0);
  });

  it("refuses an applicant", async () => {
    await signIn(mockUser({ type: "applicant" }));

    expect(await triggerJobPostingRelevanceUpdate(OWN.id)).toMatchObject({ success: false });
    expect(afterCallbacks).toHaveLength(0);
  });

  it("refuses a posting outside the session company and schedules nothing", async () => {
    supabase.queue("job_postings", { data: null, error: null });

    expect(await triggerJobPostingRelevanceUpdate(OWN.id)).toMatchObject({ success: false });
    await flushAfter();

    const [lookup] = supabase.callsFor("job_postings");
    expect(lookup.chain).toContainEqual({ method: "eq", args: ["company_id", COMPANY_A.id] });
    expect(processJobPostingRelevance).not.toHaveBeenCalled();
    expect(updatesOf("progress")).toHaveLength(0);
  });

  it("refuses while a recent run is still in progress", async () => {
    supabase.queue("job_postings", {
      data: { id: OWN.id, matching_status: "progress", updated_at: new Date().toISOString() },
      error: null,
    });

    expect(await triggerJobPostingRelevanceUpdate(OWN.id)).toMatchObject({ success: false });
    await flushAfter();

    expect(processJobPostingRelevance).not.toHaveBeenCalled();
  });

  it("restarts a run that has been stuck in progress for too long", async () => {
    supabase.queue("job_postings", {
      data: { id: OWN.id, matching_status: "progress", updated_at: "2020-01-01T00:00:00.000Z" },
      error: null,
    });

    expect(await triggerJobPostingRelevanceUpdate(OWN.id)).toMatchObject({ success: true });
  });

  it("marks the posting in progress and schedules processing once", async () => {
    supabase.queue("job_postings", {
      data: { id: OWN.id, matching_status: "completed", updated_at: OWN.updated_at },
      error: null,
    });

    expect(await triggerJobPostingRelevanceUpdate(OWN.id)).toEqual({
      success: true,
      message: "processing started",
    });
    expect(updatesOf("progress")).toHaveLength(1);
    await flushAfter();

    expect(processJobPostingRelevance).toHaveBeenCalledTimes(1);
    expect(processJobPostingRelevance).toHaveBeenCalledWith(COMPANY_A.user.id, OWN.id);
  });

  it("marks the posting failed when processing rejects", async () => {
    supabase.queue("job_postings", {
      data: { id: OWN.id, matching_status: "pending", updated_at: OWN.updated_at },
      error: null,
    });
    vi.mocked(processJobPostingRelevance).mockRejectedValue(new Error("rerank down"));

    await triggerJobPostingRelevanceUpdate(OWN.id);
    await flushAfter();

    expect(updatesOf("failed")).toHaveLength(1);
    expect(eventCaptureServerException).toHaveBeenCalled();
  });
});
