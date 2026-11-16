import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LanguageModel } from "ai";
import type { Database, Json } from "@/utils/types/database.types";
import { assertAllowance, consumeEntitlement } from "@/helpers/billing/entitlements";
import { EntitlementError } from "@/helpers/billing/errors";
import { forbiddenMessage } from "@/helpers/companies/permissions";
import { FEEDBACK_SUMMARY_COST, FEEDBACK_SUMMARY_MIN } from "./config";
import { summarizeFeedback } from "./ai/summarize-feedback";
import { readFeedbackSummary, type FeedbackSummary, type SummarySourceCard } from "./feedback-summary-schema";

type Db = SupabaseClient<Database>;

/** What the Interviews section shows (IV-REQ-051). */
export type FeedbackSummaryView = {
  submitted: number;
  min: number;
  summary: FeedbackSummary | null;
  createdAt: string | null;
  /** A scorecard was submitted or edited after the summary was made. */
  stale: boolean;
};

const REASONS: Record<string, string> = {
  not_found: "Application not found.",
  forbidden: forbiddenMessage("scorecards.view_all", { forJob: true }),
  too_few: `A summary needs at least ${FEEDBACK_SUMMARY_MIN} submitted scorecards.`,
  changed: "The scorecards changed while the summary was being written. Try again.",
  invalid_input: "Couldn't save the summary. Please try again.",
};

export const feedbackSummaryMessage = (reason: string) => REASONS[reason] ?? "Couldn't summarize the feedback.";

type RpcResult = { ok: boolean; reason?: string } & Record<string, unknown>;

/**
 * The latest feedback summary for an application, through
 * `get_feedback_summary` (`scorecards.view_all` on the job). Null without
 * access, so the section shows nothing.
 */
export async function loadFeedbackSummary(supabase: Db, applicationId: string): Promise<FeedbackSummaryView | null> {
  const { data, error } = await supabase.rpc("get_feedback_summary", { p_application_id: applicationId });
  if (error) throw new Error(`Couldn't load the feedback summary: ${error.message}`);
  const r = data as unknown as RpcResult;
  if (!r?.ok) return null;
  return {
    submitted: Number(r.submitted ?? 0),
    min: Number(r.min ?? FEEDBACK_SUMMARY_MIN),
    summary: readFeedbackSummary(r.summary),
    createdAt: typeof r.created_at === "string" ? r.created_at : null,
    stale: r.stale === true,
  };
}

export type GenerateSummaryResult =
  | { ok: true; view: FeedbackSummaryView }
  | { ok: false; error: string }
  | { ok: false; entitlement: EntitlementError };

/**
 * Summarizes an application's submitted scorecards and stores the summary
 * (IV-REQ-051). The RPCs check `scorecards.view_all` on the job and that the
 * scorecards didn't change in between. One agent message is charged after
 * the summary is saved, to the member who asked; never on a failure.
 */
export async function generateFeedbackSummary(
  supabase: Db,
  { companyId, userId, applicationId }: { companyId: string; userId: string; applicationId: string },
  { model }: { model?: LanguageModel } = {},
): Promise<GenerateSummaryResult> {
  const { data, error } = await supabase.rpc("feedback_summary_source", { p_application_id: applicationId });
  if (error) throw new Error(`Couldn't read the scorecards: ${error.message}`);
  const source = data as unknown as RpcResult & { scorecards?: SummarySourceCard[]; version?: string | null };
  if (!source?.ok) return { ok: false, error: feedbackSummaryMessage(source?.reason ?? "") };
  const cards = source.scorecards ?? [];
  if (cards.length < FEEDBACK_SUMMARY_MIN) return { ok: false, error: feedbackSummaryMessage("too_few") };

  try {
    // A preflight, so a company that's out doesn't pay for a model call.
    await assertAllowance(companyId, "agent_messages", FEEDBACK_SUMMARY_COST, userId);
  } catch (err) {
    if (err instanceof EntitlementError) return { ok: false, entitlement: err };
    throw err;
  }

  const result = await summarizeFeedback(cards, { model });
  if (!result.ok) return result;

  const { data: saved, error: saveError } = await supabase.rpc("save_feedback_summary", {
    p_application_id: applicationId,
    p_scorecard_ids: cards.map((c) => c.id),
    p_version: source.version ?? "",
    p_summary: result.summary as unknown as Json,
  });
  if (saveError) throw new Error(`Couldn't save the feedback summary: ${saveError.message}`);
  const save = saved as unknown as RpcResult & { id?: string; created_at?: string };
  if (!save?.ok) return { ok: false, error: feedbackSummaryMessage(save?.reason ?? "") };

  try {
    await consumeEntitlement(
      companyId,
      "agent_messages",
      FEEDBACK_SUMMARY_COST,
      { type: "interview_feedback_summary", id: String(save.id) },
      userId,
    );
  } catch (err) {
    if (err instanceof EntitlementError) return { ok: false, entitlement: err };
    throw err;
  }

  return {
    ok: true,
    view: {
      submitted: cards.length,
      min: FEEDBACK_SUMMARY_MIN,
      summary: result.summary,
      createdAt: save.created_at ?? null,
      stale: false,
    },
  };
}
