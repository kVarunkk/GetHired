import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { assertAllowance, consumeEntitlement } from "@/helpers/billing/entitlements";
import { EntitlementError } from "@/helpers/billing/errors";
import { summarizeFeedback } from "./ai/summarize-feedback";
import { generateFeedbackSummary, loadFeedbackSummary } from "./feedback-summary";

vi.mock("server-only", () => ({}));
vi.mock("@/helpers/billing/entitlements", () => ({ assertAllowance: vi.fn(), consumeEntitlement: vi.fn() }));
vi.mock("./ai/summarize-feedback", () => ({ summarizeFeedback: vi.fn() }));

const APP = "e1700000-0000-4000-8000-000000000001";
const ctx = { companyId: "c0000000-0000-4000-8000-000000000001", userId: "c7000000-0000-4000-8000-000000000001", applicationId: APP };
const card = (id: string) => ({
  id,
  interview_id: "f1",
  interview_name: "Systems",
  competencies: [],
  author_name: "Rita",
  overall: "yes",
  overall_note: "Fine.",
  ratings: {},
});
const SUMMARY = { agreements: [{ text: "Strong on APIs.", quotes: [] }], disagreements: [], concerns: [] };
const VERSION = "2026-11-14T10:00:00+00:00";

let db: SupabaseMock;
const rpcArgs = (fn: string) => db.callsFor(fn).map((c) => c.chain[0].args[1]);

const refused = () =>
  new EntitlementError({
    key: "agent_messages",
    kind: "allowance",
    qty: 1,
    used: 50,
    amount: 50,
    overageCredits: null,
    creditBalance: 0,
    creditsNeeded: 0,
    reason: "limit_reached",
    suggestedTier: null,
  });

beforeEach(() => {
  vi.clearAllMocks();
  db = createSupabaseMock();
  vi.mocked(assertAllowance).mockResolvedValue(undefined);
  vi.mocked(consumeEntitlement).mockResolvedValue({ source: "allowance", creditsSpent: 0, duplicate: false });
  vi.mocked(summarizeFeedback).mockResolvedValue({ ok: true, summary: SUMMARY });
});

const queueSource = (cards = [card("s1"), card("s2")]) =>
  db.queueRpc("feedback_summary_source", { data: { ok: true, version: VERSION, scorecards: cards }, error: null });

describe("loadFeedbackSummary (IV-REQ-051)", () => {
  it("reads the latest summary and whether it's stale", async () => {
    db.queueRpc("get_feedback_summary", {
      data: { ok: true, submitted: 3, min: 2, summary: SUMMARY, created_at: VERSION, stale: true },
      error: null,
    });
    expect(await loadFeedbackSummary(db.client, APP)).toEqual({
      submitted: 3,
      min: 2,
      summary: SUMMARY,
      createdAt: VERSION,
      stale: true,
    });
  });

  it("is null without scorecards.view_all", async () => {
    db.queueRpc("get_feedback_summary", { data: { ok: false, reason: "forbidden" }, error: null });
    expect(await loadFeedbackSummary(db.client, APP)).toBeNull();
  });
});

describe("generateFeedbackSummary (IV-REQ-051)", () => {
  it("summarizes, saves what it read at that version, then charges one agent message", async () => {
    queueSource();
    db.queueRpc("save_feedback_summary", { data: { ok: true, id: "sum-1", created_at: VERSION }, error: null });

    const result = await generateFeedbackSummary(db.client, ctx);

    expect(result).toEqual({
      ok: true,
      view: { submitted: 2, min: 2, summary: SUMMARY, createdAt: VERSION, stale: false },
    });
    expect(rpcArgs("save_feedback_summary")).toEqual([
      { p_application_id: APP, p_scorecard_ids: ["s1", "s2"], p_version: VERSION, p_summary: SUMMARY },
    ]);
    expect(consumeEntitlement).toHaveBeenCalledTimes(1);
    expect(consumeEntitlement).toHaveBeenCalledWith(
      ctx.companyId,
      "agent_messages",
      1,
      { type: "interview_feedback_summary", id: "sum-1" },
      ctx.userId,
    );
  });

  it("needs two submitted scorecards and doesn't call the model or charge otherwise", async () => {
    queueSource([card("s1")]);
    expect(await generateFeedbackSummary(db.client, ctx)).toEqual({
      ok: false,
      error: "A summary needs at least 2 submitted scorecards.",
    });
    expect(summarizeFeedback).not.toHaveBeenCalled();
    expect(consumeEntitlement).not.toHaveBeenCalled();
  });

  it("names the missing permission", async () => {
    db.queueRpc("feedback_summary_source", { data: { ok: false, reason: "forbidden" }, error: null });
    expect(await generateFeedbackSummary(db.client, ctx)).toEqual({
      ok: false,
      error: expect.stringMatching(/^Your role can't .* for this job\.$/),
    });
    expect(summarizeFeedback).not.toHaveBeenCalled();
  });

  it("doesn't charge when the scorecards changed meanwhile", async () => {
    queueSource();
    db.queueRpc("save_feedback_summary", { data: { ok: false, reason: "changed" }, error: null });
    expect(await generateFeedbackSummary(db.client, ctx)).toEqual({
      ok: false,
      error: "The scorecards changed while the summary was being written. Try again.",
    });
    expect(consumeEntitlement).not.toHaveBeenCalled();
  });

  it("doesn't save or charge when the model fails", async () => {
    queueSource();
    vi.mocked(summarizeFeedback).mockResolvedValue({ ok: false, error: "Couldn't summarize the feedback." });
    expect(await generateFeedbackSummary(db.client, ctx)).toEqual({ ok: false, error: "Couldn't summarize the feedback." });
    expect(db.callsFor("save_feedback_summary")).toHaveLength(0);
    expect(consumeEntitlement).not.toHaveBeenCalled();
  });

  it("stops before the model when the allowance is used up", async () => {
    queueSource();
    const err = refused();
    vi.mocked(assertAllowance).mockRejectedValue(err);
    expect(await generateFeedbackSummary(db.client, ctx)).toEqual({ ok: false, entitlement: err });
    expect(assertAllowance).toHaveBeenCalledWith(ctx.companyId, "agent_messages", 1, ctx.userId);
    expect(summarizeFeedback).not.toHaveBeenCalled();
  });
});
