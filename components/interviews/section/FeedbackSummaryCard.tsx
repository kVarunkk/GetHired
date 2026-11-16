"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Loader2, RefreshCw, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { summarizeFeedbackAction } from "@/app/actions/interviews/summarize-feedback";
import { labelFor } from "@/helpers/billing/keys";
import { FEEDBACK_SUMMARY_COST } from "@/helpers/interviews/config";
import type { SummaryPoint, SummaryQuote } from "@/helpers/interviews/feedback-summary-schema";
import type { FeedbackSummaryView } from "@/helpers/interviews/feedback-summary";
import { useEntitlementError } from "@/hooks/useEntitlementError";

const COST = `Uses ${FEEDBACK_SUMMARY_COST} ${labelFor("agent_messages", FEEDBACK_SUMMARY_COST)}.`;

/**
 * The AI summary of the panel's submitted scorecards (IVT-081, IV-REQ-051),
 * for `scorecards.view_all`. Agreements, disagreements per competency and
 * open concerns, quoting only what interviewers wrote. It never recommends a
 * decision (D16). A summary made before a scorecard was submitted or edited
 * says it's out of date.
 */
export default function FeedbackSummaryCard({
  applicationId,
  initial,
}: {
  applicationId: string;
  initial: FeedbackSummaryView;
}) {
  const router = useRouter();
  const [view, setView] = useState(initial);
  const [busy, setBusy] = useState(false);
  const { handle: handleEntitlement, dialog } = useEntitlementError();
  const { summary } = view;
  const enough = view.submitted >= view.min;

  const generate = async () => {
    setBusy(true);
    try {
      const result = await summarizeFeedbackAction({ applicationId });
      if (await handleEntitlement(result)) return;
      if (!("ok" in result)) throw new Error("unexpected");
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setView(result.view);
      router.refresh();
    } catch {
      toast.error("Couldn't summarize the feedback. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Feedback summary" className="flex flex-col gap-4 rounded-xl border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="h-4 w-4" /> Feedback summary
            {summary && view.stale && (
              <Badge variant="outline" className="font-normal">
                Out of date
              </Badge>
            )}
          </h3>
          <p className="text-sm text-muted-foreground">
            {!enough
              ? `Available once ${view.min} scorecards are submitted (${view.submitted} so far).`
              : summary && view.stale
                ? "A scorecard was submitted or changed after this summary. Regenerate it to include the latest feedback."
                : summary
                  ? "What the panel's submitted scorecards say. It doesn't recommend a decision."
                  : `Summarize the ${view.submitted} submitted scorecards: where the panel agrees, where it differs, and open concerns. ${COST}`}
          </p>
        </div>
        {enough && (!summary || view.stale) && (
          <Button type="button" variant="outline" size="sm" onClick={generate} disabled={busy}>
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : summary ? (
              <RefreshCw className="h-4 w-4" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            {summary ? "Regenerate" : "Summarize feedback"}
          </Button>
        )}
      </div>

      {summary && (
        <div className="flex flex-col gap-4">
          <PointList title="Where the panel agrees" points={summary.agreements} empty="No clear agreement." />
          <PointList
            title="Where it differs"
            points={summary.disagreements.map((d) => ({ ...d, label: d.competency }))}
            empty="No disagreements."
          />
          <PointList title="Open concerns" points={summary.concerns} empty="None raised." />
          {view.stale && <p className="text-xs text-muted-foreground">{COST}</p>}
        </div>
      )}
      {dialog}
    </section>
  );
}

function PointList({
  title,
  points,
  empty,
}: {
  title: string;
  points: (SummaryPoint & { label?: string })[];
  empty: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      {points.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {points.map((p, i) => (
            <li key={i} className="flex flex-col gap-1 text-sm">
              <p>
                {p.label && <span className="font-medium">{p.label}: </span>}
                {p.text}
              </p>
              {p.quotes.map((q, j) => (
                <Quote key={j} quote={q} />
              ))}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Quote({ quote }: { quote: SummaryQuote }) {
  return (
    <blockquote className="border-l-2 pl-3 text-sm text-muted-foreground">
      &ldquo;{quote.quote}&rdquo;
      <span className="ml-1 text-xs">
        ({quote.author}, {quote.interview})
      </span>
    </blockquote>
  );
}
