import { describe, expect, it } from "vitest";
import { createSupabaseMock } from "@/test/utils/supabase-mock";
import { markJobResultsStale } from "./mark-stale";

const JOB_ID = "b0000000-0000-4000-8000-000000000001";

describe("markJobResultsStale", () => {
  it("marks completed screenings stale and re-queues them with the unscored ones (BI-REQ-036)", async () => {
    const admin = createSupabaseMock();
    admin.queue("application_screenings", { data: [{ application_id: "e1" }], error: null });
    admin.queue("job_relevant_profiles", { data: null, error: null });
    admin.queue("application_screenings", { data: [{ application_id: "ea1" }], error: null });
    admin.queueRpc("send_batch", { data: null, error: null });

    await markJobResultsStale(admin.client, JOB_ID);

    const [stale, unscored] = admin.callsFor("application_screenings");
    expect(stale.chain).toContainEqual({ method: "eq", args: ["status", "completed"] });
    expect(unscored.chain).toContainEqual({ method: "eq", args: ["status", "insufficient_info"] });
    expect(unscored.chain).toContainEqual({
      method: "update",
      args: [expect.objectContaining({ status: "queued", attempts: 0 })],
    });
    const [send] = admin.callsFor("send_batch");
    expect(send.chain[0].args[1]).toMatchObject({
      messages: [{ application_id: "e1" }, { application_id: "ea1" }],
    });
  });
});
