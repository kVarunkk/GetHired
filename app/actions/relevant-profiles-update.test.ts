import { beforeEach, describe, expect, it, vi } from "vitest";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { eventCaptureServerException } from "@/helpers/posthog/EventCaptureServerException";
import { mockUser, setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A, jobPostingOf } from "@/test/utils/recruiter";
import { triggerJobPostingRelevanceUpdate } from "./relevant-profiles-update";

vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/helpers/posthog/EventCaptureServerException", () => ({
  eventCaptureServerException: vi.fn(),
}));

const OWN = jobPostingOf(COMPANY_A);

let supabase: SupabaseMock;
let service: SupabaseMock;

/** Messages sent to the relevance_profiles queue. */
const sent = () =>
  service
    .callsFor("send")
    .filter((c) => c.schema === "pgmq_public")
    .map((c) => c.chain[0].args[1]);

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
  service = createSupabaseMock();
  vi.mocked(createServiceRoleClient).mockReturnValue(service.client);
});

describe("triggerJobPostingRelevanceUpdate", () => {
  it("refuses an unauthenticated caller", async () => {
    await setRequestUser(null, supabase.client);

    expect(await triggerJobPostingRelevanceUpdate(OWN.id)).toMatchObject({ success: false });
    expect(sent()).toHaveLength(0);
  });

  it("refuses an applicant", async () => {
    await signIn(mockUser({ type: "applicant" }));

    expect(await triggerJobPostingRelevanceUpdate(OWN.id)).toMatchObject({ success: false });
    expect(sent()).toHaveLength(0);
  });

  it("refuses a posting outside the session company and schedules nothing", async () => {
    supabase.queue("job_postings", { data: null, error: null });

    expect(await triggerJobPostingRelevanceUpdate(OWN.id)).toMatchObject({ success: false });

    const [lookup] = supabase.callsFor("job_postings");
    expect(lookup.chain).toContainEqual({ method: "eq", args: ["company_id", COMPANY_A.id] });
    expect(sent()).toHaveLength(0);
    expect(updatesOf("progress")).toHaveLength(0);
  });

  it("refuses while a recent run is still in progress", async () => {
    supabase.queue("job_postings", {
      data: { id: OWN.id, matching_status: "progress", updated_at: new Date().toISOString() },
      error: null,
    });

    expect(await triggerJobPostingRelevanceUpdate(OWN.id)).toMatchObject({ success: false });

    expect(sent()).toHaveLength(0);
  });

  it("restarts a run that has been stuck in progress for too long", async () => {
    supabase.queue("job_postings", {
      data: { id: OWN.id, matching_status: "progress", updated_at: "2020-01-01T00:00:00.000Z" },
      error: null,
    });

    expect(await triggerJobPostingRelevanceUpdate(OWN.id)).toMatchObject({ success: true });
  });

  it("marks the posting in progress and queues one message for the worker", async () => {
    supabase.queue("job_postings", {
      data: { id: OWN.id, matching_status: "completed", updated_at: OWN.updated_at },
      error: null,
    });

    expect(await triggerJobPostingRelevanceUpdate(OWN.id)).toEqual({
      success: true,
      message: "processing started",
    });
    expect(updatesOf("progress")).toHaveLength(1);
    expect(sent()).toEqual([
      {
        queue_name: "relevance_profiles",
        message: { userId: COMPANY_A.user.id, jobId: OWN.id },
        sleep_seconds: 0,
      },
    ]);
  });

  it("marks the posting failed and reports it when the message can't be queued", async () => {
    supabase.queue("job_postings", {
      data: { id: OWN.id, matching_status: "pending", updated_at: OWN.updated_at },
      error: null,
    });
    service.queueRpc("send", { data: null, error: { message: "queue down" } }, "pgmq_public");

    expect(await triggerJobPostingRelevanceUpdate(OWN.id)).toEqual({
      success: false,
      error: "Failed to start matching.",
    });
    expect(updatesOf("failed")).toHaveLength(1);
    expect(eventCaptureServerException).toHaveBeenCalled();
  });

  it("no longer does the matching inside the request", async () => {
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("./relevant-profiles-update.ts", import.meta.url), "utf8"),
    );
    expect(source).not.toMatch(/\bafter\(/);
    expect(source).not.toContain("processJobPostingRelevance");
  });
});
