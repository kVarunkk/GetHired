import { beforeEach, describe, expect, it, vi } from "vitest";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import {
  PIPELINE_EMAIL_QUEUE,
  PIPELINE_EMAIL_UNDO_SECONDS,
  enqueuePipelineEmails,
  type PipelineEmailMessage,
} from "./email-queue";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));

let db: SupabaseMock;

const MESSAGE: PipelineEmailMessage = {
  applicationId: "e0000000-0000-4000-8000-000000000001",
  companyId: "c1",
  candidateUserId: "u1",
  actorUserId: "a1",
  actorName: "Asha",
  templateId: "t1",
  subject: "Next steps",
  body: "Hi",
  companyName: "Acme",
  companyEmail: null,
  logoUrl: null,
  toStageId: "s1",
  stageEnteredAt: "2026-11-13T10:00:00+00:00",
};

beforeEach(() => {
  db = createSupabaseMock();
  vi.mocked(createServiceRoleClient).mockReturnValue(db.client as never);
});

describe("enqueuePipelineEmails (QF-REQ-012)", () => {
  it("delays every message by the undo window, so a move undone in 2 minutes never emails", async () => {
    expect(PIPELINE_EMAIL_UNDO_SECONDS).toBe(120);

    await enqueuePipelineEmails([MESSAGE]);

    const [call] = db.callsFor("send_batch");
    expect(call.chain[0].args[1]).toEqual({
      queue_name: PIPELINE_EMAIL_QUEUE,
      messages: [MESSAGE],
      sleep_seconds: 120,
    });
  });

  it("sends nothing for an empty list", async () => {
    await enqueuePipelineEmails([]);
    expect(db.calls).toHaveLength(0);
  });

  it("throws when the send fails", async () => {
    db.queueRpc("send_batch", { data: null, error: { message: "down" } }, "pgmq_public");
    await expect(enqueuePipelineEmails([MESSAGE])).rejects.toThrow("Couldn't queue the emails");
  });
});
