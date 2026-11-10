import { beforeEach, describe, expect, it, vi } from "vitest";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { eventCaptureServerException } from "@/helpers/posthog/EventCaptureServerException";
import { mockUser, setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { MEMBER_A, OWNER_A } from "@/test/utils/team";
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
  service
    .callsFor("job_postings")
    .filter((c) =>
      c.chain.some(
        (m) => m.method === "update" && (m.args[0] as { matching_status?: string }).matching_status === status,
      ),
    );

async function signIn(user = COMPANY_A.user) {
  supabase = createSupabaseMock({ user });
  supabase.queueRpc("my_company_access", { data: OWNER_A.membership, error: null });
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

  // The start is one start_matching call on the caller's session (SM-REQ-004):
  // the database checks matching.run and whether a live run holds the job.
  // supabase/tests/state_machines.sql block 3 covers its decisions.
  const startAnswers = (data: unknown) => supabase.queueRpc("start_matching", { data, error: null });
  const starts = () => supabase.callsFor("start_matching").map((c) => c.chain[0].args[1]);

  it("refuses a posting outside the session company and schedules nothing", async () => {
    startAnswers({ ok: false, reason: "forbidden" });

    expect(await triggerJobPostingRelevanceUpdate(OWN.id)).toEqual({ success: false, error: "Job posting not found." });

    expect(sent()).toHaveLength(0);
    expect(updatesOf("progress")).toHaveLength(0);
  });

  it("refuses while a live run holds the job", async () => {
    startAnswers({ ok: false, reason: "in_progress" });

    expect(await triggerJobPostingRelevanceUpdate(OWN.id)).toMatchObject({ success: false });

    expect(sent()).toHaveLength(0);
  });

  it("starts the posting and queues one message for the worker", async () => {
    startAnswers({ ok: true });

    expect(await triggerJobPostingRelevanceUpdate(OWN.id)).toEqual({
      success: true,
      message: "processing started",
    });
    expect(starts()).toEqual([{ p_job_id: OWN.id, p_timeout_seconds: 1200 }]);
    expect(updatesOf("progress")).toHaveLength(0);
    expect(sent()).toEqual([
      {
        queue_name: "relevance_profiles",
        message: { userId: COMPANY_A.user.id, jobId: OWN.id },
        sleep_seconds: 0,
      },
    ]);
  });

  it("lets a member run matching, started with the member's session and queued under the owner's id (TM-CON-001)", async () => {
    supabase = createSupabaseMock({ user: MEMBER_A.user });
    supabase.queueRpc("my_company_access", { data: MEMBER_A.membership, error: null });
    startAnswers({ ok: true });
    await setRequestUser(MEMBER_A.user, supabase.client);

    expect(await triggerJobPostingRelevanceUpdate(OWN.id)).toMatchObject({ success: true });
    expect(starts()).toHaveLength(1);
    expect(sent()[0]).toMatchObject({ message: { userId: COMPANY_A.user.id, jobId: OWN.id } });
  });

  it("marks the posting failed and reports it when the message can't be queued", async () => {
    startAnswers({ ok: true });
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
