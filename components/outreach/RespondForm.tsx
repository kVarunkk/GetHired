"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowRight, Check, Flag, Loader2 } from "lucide-react";
import toast from "react-hot-toast";
import { respondToOutreachAction } from "@/app/actions/outreach/respond-to-outreach";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  DECLINE_REASON_OPTIONS,
  OUTREACH_CONTACT_MAX,
  OUTREACH_NOTE_MAX,
} from "@/helpers/outreach/config";
import type { DeclineReason, OutreachResponseStatus, OutreachStatus } from "@/utils/types/outreach.types";

const NO_REASON = "none";

const ANSWERED: Record<OutreachResponseStatus, string> = {
  interested: "You said you're interested. The company can now see your contact details and resume.",
  not_interested: "You said you're not interested.",
  reported: "You reported this message. We'll look into it.",
};

const CLOSED: Partial<Record<OutreachStatus, string>> = {
  expired: "This message expired without an answer.",
  withdrawn: "The company withdrew this message.",
};

/**
 * The candidate's answer (OR-REQ-003): Interested (note, preferred contact),
 * Not interested (reason), block the company, or report the message.
 */
export default function RespondForm({
  outreachId,
  companyName,
  status,
  open,
  applyHref,
}: {
  outreachId: string;
  companyName: string;
  status: OutreachStatus;
  /** Still answerable (sent and not past its expiry). */
  open: boolean;
  /** `/jobs/<all_jobs id>?apply=true` when the job is still open. */
  applyHref: string | null;
}) {
  const router = useRouter();
  const [answered, setAnswered] = useState<OutreachStatus>(status);
  const [choice, setChoice] = useState<OutreachResponseStatus | null>(null);
  const [note, setNote] = useState("");
  const [contact, setContact] = useState("");
  const [reason, setReason] = useState<DeclineReason | "">("");
  const [block, setBlock] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (next: OutreachResponseStatus) => {
    setBusy(true);
    setError(null);
    try {
      const result = await respondToOutreachAction({
        outreachId,
        status: next,
        reason: next === "not_interested" && reason ? reason : null,
        note: next !== "not_interested" ? note : undefined,
        contact: next === "interested" ? contact : undefined,
        block: next === "interested" ? false : block,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setAnswered(next);
      toast.success(next === "interested" ? `We told ${companyName}.` : "Thanks, your answer is saved.");
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  if (answered in ANSWERED) {
    return (
      <div className="flex flex-col gap-3 rounded-xl border bg-muted/30 p-4">
        <p className="flex items-center gap-2 text-sm">
          <Check className="h-4 w-4 text-success" />
          {ANSWERED[answered as OutreachResponseStatus]}
        </p>
        {answered === "interested" && applyHref && (
          <Button asChild variant="brand" className="w-fit">
            <Link href={applyHref}>
              Apply now <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        )}
      </div>
    );
  }

  if (!open) {
    return (
      <p className="rounded-xl border bg-muted/30 p-4 text-sm text-muted-foreground">
        {CLOSED[answered] ?? "This message expired without an answer."}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border p-4">
      <div className="flex flex-wrap gap-2">
        <Button
          variant={choice === "interested" ? "brand" : "outline"}
          aria-pressed={choice === "interested"}
          onClick={() => setChoice("interested")}
          disabled={busy}
        >
          Interested
        </Button>
        <Button
          variant="outline"
          aria-pressed={choice === "not_interested"}
          className={choice === "not_interested" ? "bg-muted" : undefined}
          onClick={() => setChoice("not_interested")}
          disabled={busy}
        >
          Not interested
        </Button>
        <Button variant="ghost" onClick={() => setChoice("reported")} disabled={busy}>
          <Flag className="mr-2 h-4 w-4" />
          Report
        </Button>
      </div>

      {choice === "interested" && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            {companyName} will see your contact details and resume, and gets an email.
          </p>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">Note (optional)</span>
            <Textarea
              aria-label="Note"
              value={note}
              maxLength={OUTREACH_NOTE_MAX}
              rows={3}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">
              Phone or preferred contact (optional)
            </span>
            <Input
              aria-label="Preferred contact"
              value={contact}
              maxLength={OUTREACH_CONTACT_MAX}
              onChange={(e) => setContact(e.target.value)}
            />
          </label>
          <Button variant="brand" className="w-fit" disabled={busy} onClick={() => void submit("interested")}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Send my answer
          </Button>
        </div>
      )}

      {(choice === "not_interested" || choice === "reported") && (
        <div className="flex flex-col gap-3">
          {choice === "not_interested" ? (
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">Reason (optional)</span>
              <Select
                value={reason || NO_REASON}
                onValueChange={(value) => setReason(value === NO_REASON ? "" : (value as DeclineReason))}
              >
                <SelectTrigger aria-label="Reason" className="sm:w-72">
                  <SelectValue placeholder="Prefer not to say" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_REASON}>Prefer not to say</SelectItem>
                  {DECLINE_REASON_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">
                What&apos;s wrong with this message? (optional)
              </span>
              <Textarea
                aria-label="Report details"
                value={note}
                maxLength={OUTREACH_NOTE_MAX}
                rows={3}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
          )}
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              aria-label="Block this company"
              checked={block}
              onCheckedChange={(v) => setBlock(v === true)}
            />
            Block {companyName} from contacting me again
          </label>
          <Button variant="outline" className="w-fit" disabled={busy} onClick={() => void submit(choice)}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {choice === "reported" ? "Report" : "Send my answer"}
          </Button>
        </div>
      )}

      {error && (
        <p role="alert" className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" />
          {error}
        </p>
      )}
    </div>
  );
}
