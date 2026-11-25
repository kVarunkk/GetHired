import { beforeEach, describe, expect, it, vi } from "vitest";
import { setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock, type RecordedCall, type SupabaseMock } from "@/test/utils/supabase-mock";
import { PUBLIC_APPLICANT } from "@/test/utils/recruiter";
import { attachmentOf } from "@/test/utils/outreach";
import { detachFromApplicationAction } from "./attachments";

vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const ATTACHMENT_ID = "a7000000-0000-4000-8000-000000000001";

let supabase: SupabaseMock;

const has = (call: RecordedCall, method: string) => call.chain.some((m) => m.method === method);
const eqs = (call: RecordedCall) => call.chain.filter((m) => m.method === "eq").map((m) => m.args);


beforeEach(async () => {
  vi.clearAllMocks();
  supabase = createSupabaseMock({ user: PUBLIC_APPLICANT.user });
  await setRequestUser(PUBLIC_APPLICANT.user, supabase.client);
});

describe("detachFromApplicationAction (ORT-061)", () => {
  it("deletes an unopened attachment, guarded on first_viewed_at", async () => {
    supabase.queue("application_attachments", { data: attachmentOf("interview_session", { id: ATTACHMENT_ID }), error: null });
    supabase.queue("application_attachments", { data: [{ id: ATTACHMENT_ID }], error: null });

    expect(await detachFromApplicationAction({ attachmentId: ATTACHMENT_ID })).toEqual({ ok: true });
    const [read, del] = supabase.callsFor("application_attachments");
    expect(eqs(read)).toContainEqual(["applications.applicant_user_id", PUBLIC_APPLICANT.user.id]);
    expect(has(del, "delete")).toBe(true);
    expect(del.chain).toContainEqual({ method: "is", args: ["first_viewed_at", null] });
  });

  it("refuses once the company has opened it", async () => {
    supabase.queue("application_attachments", {
      data: attachmentOf("interview_session", { id: ATTACHMENT_ID, first_viewed_at: "2026-10-16T00:00:00.000Z" }),
      error: null,
    });

    expect(await detachFromApplicationAction({ attachmentId: ATTACHMENT_ID })).toEqual({
      ok: false,
      error: "The company has already opened it.",
    });
    expect(supabase.callsFor("application_attachments").filter((c) => has(c, "delete"))).toHaveLength(0);
  });

  it("refuses when it was opened between the read and the delete", async () => {
    supabase.queue("application_attachments", { data: attachmentOf("resume_review", { id: ATTACHMENT_ID }), error: null });
    supabase.queue("application_attachments", { data: [], error: null });

    expect(await detachFromApplicationAction({ attachmentId: ATTACHMENT_ID })).toEqual({
      ok: false,
      error: "The company has already opened it.",
    });
  });

  it("treats another user's attachment as not found", async () => {
    supabase.queue("application_attachments", { data: null, error: null });

    expect((await detachFromApplicationAction({ attachmentId: ATTACHMENT_ID })).ok).toBe(false);
    expect(supabase.callsFor("application_attachments").filter((c) => has(c, "delete"))).toHaveLength(0);
  });
});
