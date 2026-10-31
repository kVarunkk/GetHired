"use client";

import { useId, useState } from "react";
import { X } from "lucide-react";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { submitAgentFeedbackAction } from "@/app/actions/submit-agent-feedback";
import {
  FEEDBACK_COMMENT_MAX,
  isPositiveSurveyRating,
  reasonsFor,
} from "@/helpers/agent/feedback";
import type { AgentRoleId } from "@/helpers/agent/roles/types";

export type SurveyCardState = "open" | "answered" | "dismissed";

const RATINGS = ["1", "2", "3", "4", "5"];
const SAVE_FAILED = "Couldn't save your feedback. Please try again.";

/**
 * The occasional survey card the server adds under a reply (AF-REQ-013–015):
 * a 1–5 rating, reasons and a comment, or dismiss. The parent owns whether
 * it was answered or dismissed, so a reload shows the same.
 */
export default function FeedbackSurveyCard({
  sessionId,
  messageId,
  role,
  state,
  onChange,
}: {
  sessionId: string;
  messageId: string;
  role: AgentRoleId;
  state: SurveyCardState;
  onChange: (state: Exclude<SurveyCardState, "open">) => void;
}) {
  const titleId = useId();
  const [rating, setRating] = useState<number | null>(null);
  const [reasons, setReasons] = useState<string[]>([]);
  const [comment, setComment] = useState("");
  const [sending, setSending] = useState(false);

  if (state === "dismissed") return null;
  if (state === "answered") {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Thanks — this helps us improve the agent.
      </p>
    );
  }

  const save = async (input: Record<string, unknown>, next: "answered" | "dismissed") => {
    setSending(true);
    try {
      const result = await submitAgentFeedbackAction({ sessionId, messageId, kind: "survey", ...input });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      onChange(next);
    } catch {
      toast.error(SAVE_FAILED);
    } finally {
      setSending(false);
    }
  };

  const chooseRating = (value: string) => {
    if (!value) return; // Radix sends "" when the chosen item is clicked again.
    const next = Number(value);
    // Positive and negative reasons are different lists.
    if (rating !== null && isPositiveSurveyRating(rating) !== isPositiveSurveyRating(next)) setReasons([]);
    setRating(next);
  };

  return (
    <section
      aria-labelledby={titleId}
      className="flex flex-col gap-3 rounded-xl border p-4 duration-300 animate-in fade-in"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 id={titleId} className="text-sm font-semibold">
          How&apos;s the agent working for you?
        </h3>
        <Button
          size="icon"
          variant="ghost"
          className="-mr-2 -mt-2 h-7 w-7 text-muted-foreground"
          aria-label="Dismiss"
          disabled={sending}
          onClick={() => void save({ dismissed: true }, "dismissed")}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="flex flex-col gap-1.5">
        <ToggleGroup
          type="single"
          variant="outline"
          value={rating === null ? "" : String(rating)}
          onValueChange={chooseRating}
          aria-label="Rating from 1 (not useful) to 5 (very useful)"
          className="justify-start"
        >
          {RATINGS.map((value) => (
            <ToggleGroupItem
              key={value}
              value={value}
              aria-label={`Rate ${value} out of 5`}
              className="w-10 data-[state=on]:border-foreground/40"
            >
              {value}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <div className="flex w-[13.5rem] justify-between text-xs text-muted-foreground">
          <span>Not useful</span>
          <span>Very useful</span>
        </div>
      </div>

      {rating !== null && (
        <>
          <ToggleGroup
            type="multiple"
            variant="outline"
            size="sm"
            value={reasons}
            onValueChange={setReasons}
            aria-label={isPositiveSurveyRating(rating) ? "What went well?" : "What could be better?"}
            className="flex-wrap justify-start"
          >
            {reasonsFor(role, { positive: isPositiveSurveyRating(rating) }).map((reason) => (
              <ToggleGroupItem
                key={reason.key}
                value={reason.key}
                className="h-7 rounded-full px-3 text-xs font-normal data-[state=on]:border-foreground/40"
              >
                {reason.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <Textarea
            aria-label="Anything else?"
            placeholder="Anything else?"
            maxLength={FEEDBACK_COMMENT_MAX}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            className="min-h-20 text-sm"
          />
        </>
      )}

      <div className="flex justify-end">
        <Button
          size="sm"
          variant="brand"
          disabled={rating === null || sending}
          onClick={() =>
            void save(
              { rating, reasons, ...(comment.trim() ? { comment } : {}) },
              "answered",
            )
          }
        >
          Submit
        </Button>
      </div>
    </section>
  );
}
