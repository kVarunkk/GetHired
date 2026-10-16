"use client";

import { useEffect, useState } from "react";
import {
  previewAgentOutreachAction,
  type PreviewAgentOutreachResult,
} from "@/app/actions/outreach/preview-agent-outreach";

type OutreachInput = { subject?: unknown; message?: unknown };

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

function quotaLabel(quota: { remaining: number | null; amount: number | null } | null) {
  if (!quota) return null;
  if (quota.remaining === null) return "Unlimited on your plan";
  return `${quota.remaining} of ${quota.amount ?? quota.remaining} left this month`;
}

/**
 * What an agent's outreach will send, for its approval card (RA-REQ-005,
 * RA spec §4.7): to whom, about which job, the subject and the full message
 * as plain text, and the quota left. The recipient comes from the server
 * preview, which warns first when the send would be refused.
 */
export function OutreachApprovalDetails({ input }: { input: unknown }) {
  const [preview, setPreview] = useState<PreviewAgentOutreachResult | null>(null);
  const key = JSON.stringify(input ?? null);
  const { subject, message } = (input ?? {}) as OutreachInput;

  useEffect(() => {
    let cancelled = false;
    previewAgentOutreachAction(JSON.parse(key))
      .then((result) => !cancelled && setPreview(result))
      .catch(() => !cancelled && setPreview({ ok: false, error: "Couldn't load the preview." }));
    return () => {
      cancelled = true;
    };
  }, [key]);

  if (!preview) return <p className="text-xs text-muted-foreground">Loading the preview…</p>;
  if (!preview.ok) {
    return <p className="text-xs text-destructive">This message won&apos;t go through: {preview.error}</p>;
  }

  const name = preview.candidateName?.trim() || "the candidate";
  const warning = !preview.acceptsOutreach
    ? `${name} isn't accepting outreach right now.`
    : !preview.jobFound
      ? "That job wasn't found in your company."
      : preview.quota?.remaining === 0
        ? "You've used this month's outreach."
        : null;
  const quota = quotaLabel(preview.quota);

  return (
    <div className="flex flex-col gap-3 text-xs">
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
        <dt className="text-muted-foreground">To</dt>
        <dd className="text-foreground">{preview.candidateName?.trim() || "Candidate"}</dd>
        <dt className="text-muted-foreground">Job</dt>
        <dd className="text-foreground">{preview.jobTitle ?? "No job"}</dd>
        {quota && (
          <>
            <dt className="text-muted-foreground">Outreach</dt>
            <dd className="text-foreground">{quota}</dd>
          </>
        )}
      </dl>
      {warning && <p className="text-destructive">This message won&apos;t go through: {warning}</p>}
      {!warning && preview.openSince && (
        <p className="text-warning">
          {name} hasn&apos;t answered your message from {formatDate(preview.openSince)} yet.
        </p>
      )}
      <div className="flex flex-col gap-1 rounded-lg border bg-background p-3">
        <p className="font-medium text-foreground">{typeof subject === "string" ? subject : ""}</p>
        {/* Plain text: exactly what was written, nothing rendered or linked. */}
        <p className="whitespace-pre-wrap break-words text-muted-foreground">
          {typeof message === "string" ? message : ""}
        </p>
      </div>
      <p className="text-muted-foreground">
        They answer on GetHired. Contact details are shared if they say they&apos;re interested.
      </p>
    </div>
  );
}
