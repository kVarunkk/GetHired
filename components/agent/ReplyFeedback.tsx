"use client";

import { useState } from "react";
import { ThumbsDown, ThumbsUp, X } from "lucide-react";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  removeAgentFeedbackAction,
  submitAgentFeedbackAction,
  type AgentFeedbackResult,
} from "@/app/actions/submit-agent-feedback";
import { FEEDBACK_COMMENT_MAX, reasonsFor } from "@/helpers/agent/feedback";
import type { AgentRoleId } from "@/helpers/agent/roles/types";
import { cn } from "@/utils/utils";

export type ReplyVote = -1 | 1;

const SAVE_FAILED = "Couldn't save your feedback. Please try again.";

/** Runs a feedback action; a refusal or a throw comes back as its message. */
async function run(action: () => Promise<AgentFeedbackResult>): Promise<string | null> {
  try {
    const result = await action();
    return result.ok ? null : result.error;
  } catch {
    return SAVE_FAILED;
  }
}

/**
 * 👍/👎 under an assistant reply (AF-REQ-001–004). One click saves (and
 * clicking the pressed one removes the vote); after a 👎, a popover asks what
 * went wrong. The parent owns the vote, so it survives re-renders and reloads.
 */
export default function ReplyFeedback({
  sessionId,
  messageId,
  role,
  value,
  onChange,
}: {
  sessionId: string;
  messageId: string;
  role: AgentRoleId;
  value: ReplyVote | undefined;
  onChange: (value: ReplyVote | undefined) => void;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [reasons, setReasons] = useState<string[]>([]);
  const [comment, setComment] = useState("");
  const [sending, setSending] = useState(false);
  const [thanked, setThanked] = useState(false);

  const vote = async (next: ReplyVote) => {
    const previous = value;
    const removing = previous === next;
    setThanked(false);
    setDetailsOpen(false);
    onChange(removing ? undefined : next); // Optimistic (AF-REQ-003).

    const error = await run(() =>
      removing
        ? removeAgentFeedbackAction({ sessionId, messageId })
        : submitAgentFeedbackAction({ sessionId, messageId, kind: "reply", rating: next }),
    );
    if (error) {
      onChange(previous);
      toast.error(error);
      return;
    }
    if (!removing && next === -1) {
      setReasons([]);
      setComment("");
      setDetailsOpen(true);
    }
  };

  const submitDetails = async () => {
    setSending(true);
    const error = await run(() =>
      submitAgentFeedbackAction({
        sessionId,
        messageId,
        kind: "reply",
        rating: -1,
        reasons,
        ...(comment.trim() ? { comment } : {}),
      }),
    );
    setSending(false);
    if (error) {
      toast.error(error);
      return;
    }
    setDetailsOpen(false);
    setThanked(true);
  };

  const thumb = (rating: ReplyVote) => {
    const pressed = value === rating;
    const Icon = rating === 1 ? ThumbsUp : ThumbsDown;
    return (
      <Button
        size="icon"
        variant="ghost"
        className={cn("h-8 w-8 text-muted-foreground", pressed && "text-foreground")}
        aria-label={rating === 1 ? "Good response" : "Bad response"}
        aria-pressed={pressed}
        onClick={() => void vote(rating)}
      >
        <Icon className={cn("h-3.5 w-3.5", pressed && "fill-current")} />
      </Button>
    );
  };

  return (
    <div className="flex items-center gap-0.5">
      {thumb(1)}
      <Popover open={detailsOpen} onOpenChange={setDetailsOpen}>
        <PopoverAnchor asChild>
          <span className="inline-flex">{thumb(-1)}</span>
        </PopoverAnchor>
        <PopoverContent align="start" className="w-80 shadow-none">
          <div className="flex items-start justify-between gap-2">
            <p id={`feedback-${messageId}`} className="text-sm font-semibold">
              What went wrong?
            </p>
            <Button
              size="icon"
              variant="ghost"
              className="-mr-2 -mt-2 h-7 w-7 text-muted-foreground"
              aria-label="Close"
              onClick={() => setDetailsOpen(false)}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
          <ToggleGroup
            type="multiple"
            variant="outline"
            size="sm"
            value={reasons}
            onValueChange={setReasons}
            aria-labelledby={`feedback-${messageId}`}
            className="mt-3 flex-wrap justify-start"
          >
            {reasonsFor(role).map((reason) => (
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
            className="mt-3 min-h-20 text-sm"
          />
          <div className="mt-3 flex justify-end">
            <Button size="sm" onClick={() => void submitDetails()} disabled={sending}>
              Submit
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      {thanked && (
        <span role="status" className="ml-1 text-xs text-muted-foreground">
          Thanks for the feedback
        </span>
      )}
    </div>
  );
}
