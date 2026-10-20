import { beforeEach, describe, expect, it, vi } from "vitest";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { createSupabaseMock, type RecordedCall, type SupabaseMock } from "@/test/utils/supabase-mock";
import { attachmentOf } from "@/test/utils/outreach";
import { loadSharedSignals, markSharedSignalsViewed } from "./shared-signals";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));

const APPLICATION_ID = "e0000000-0000-4000-8000-000000000001";
const REPORT = {
  summary: "Strong.",
  competencies: [],
  evidence_quotes: [],
  concerns: [],
  follow_up_questions: [],
};

let rls: SupabaseMock;
let admin: SupabaseMock;

const eqs = (call: RecordedCall) => call.chain.filter((m) => m.method === "eq").map((m) => m.args);

beforeEach(() => {
  vi.clearAllMocks();
  rls = createSupabaseMock();
  admin = createSupabaseMock();
  vi.mocked(createServiceRoleClient).mockReturnValue(admin.client);
});

describe("loadSharedSignals (ORT-064)", () => {
  it("reads attachments and only the company analysis with the company's client", async () => {
    const session = attachmentOf("interview_session");
    rls.queue("application_attachments", { data: [session], error: null });
    rls.queue("interview_analyses", { data: { status: "completed", result: REPORT }, error: null });

    const shared = await loadSharedSignals(rls.client, APPLICATION_ID);

    expect(shared).toEqual({ interview: { status: "completed", result: REPORT }, review: null, unviewedIds: [session.id] });
    expect(eqs(rls.callsFor("application_attachments")[0])).toContainEqual(["application_id", APPLICATION_ID]);
    const analysis = rls.callsFor("interview_analyses")[0];
    expect(eqs(analysis)).toContainEqual(["interview_session_id", session.interview_session_id]);
    expect(eqs(analysis)).toContainEqual(["perspective", "company"]);
    // Never the transcript, never through the service role.
    expect(rls.callsFor("interview_sessions")).toHaveLength(0);
    expect(admin.calls).toHaveLength(0);
  });

  it("shows a queued report before the analysis row is visible", async () => {
    rls.queue("application_attachments", { data: [attachmentOf("interview_session")], error: null });
    rls.queue("interview_analyses", { data: null, error: null });

    expect((await loadSharedSignals(rls.client, APPLICATION_ID)).interview).toEqual({ status: "queued", result: null });
  });

  it("marks a malformed completed report as failed", async () => {
    rls.queue("application_attachments", { data: [attachmentOf("interview_session")], error: null });
    rls.queue("interview_analyses", { data: { status: "completed", result: { overall_feedback: "x" } }, error: null });

    expect((await loadSharedSignals(rls.client, APPLICATION_ID)).interview).toEqual({ status: "failed", result: null });
  });

  it("reads only the attached review's score and summary with the service role", async () => {
    const review = attachmentOf("resume_review", { first_viewed_at: "2026-10-16T00:00:00.000Z" });
    rls.queue("application_attachments", { data: [review], error: null });
    admin.queue("resume_reviews", { data: { score: 82, ai_response: { overall_feedback: "Good." } }, error: null });

    const shared = await loadSharedSignals(rls.client, APPLICATION_ID);

    expect(shared).toEqual({ interview: null, review: { score: 82, summary: "Good." }, unviewedIds: [] });
    const query = admin.callsFor("resume_reviews")[0];
    expect(query.chain).toContainEqual({ method: "select", args: ["score, ai_response"] });
    expect(eqs(query)).toContainEqual(["id", review.resume_review_id]);
  });

  it("returns nothing when nothing is shared", async () => {
    rls.queue("application_attachments", { data: [], error: null });

    expect(await loadSharedSignals(rls.client, APPLICATION_ID)).toEqual({ interview: null, review: null, unviewedIds: [] });
  });
});

describe("markSharedSignalsViewed", () => {
  it("sets first_viewed_at once, only on unviewed attachments of the application", async () => {
    await markSharedSignalsViewed(APPLICATION_ID, ["a1", "a2"]);

    const [update] = admin.callsFor("application_attachments");
    expect(update.chain[0]).toEqual({ method: "update", args: [{ first_viewed_at: expect.any(String) }] });
    expect(update.chain).toContainEqual({ method: "eq", args: ["application_id", APPLICATION_ID] });
    expect(update.chain).toContainEqual({ method: "in", args: ["id", ["a1", "a2"]] });
    expect(update.chain).toContainEqual({ method: "is", args: ["first_viewed_at", null] });
  });

  it("does nothing with no ids", async () => {
    await markSharedSignalsViewed(APPLICATION_ID, []);

    expect(admin.calls).toHaveLength(0);
  });
});
