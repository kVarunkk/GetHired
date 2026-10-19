"use client";

import { useEffect, useState } from "react";
import {
  previewAgentInterviewInviteAction,
  type PreviewAgentInterviewInviteResult,
} from "@/app/actions/interviews/preview-agent-interview-invite";

type ConfigInput = {
  enabled?: boolean;
  inviteRule?: string;
  fitThreshold?: number;
  questions?: string[];
  competencies?: { name: string; description: string }[];
  durationMinutes?: number;
  deadlineDays?: number;
};

/**
 * The exact setup the agent's `configureScreeningInterview` call saves, for
 * its approval card (§3.5). Read from the input: nothing is saved until the
 * user approves.
 */
export function InterviewConfigApprovalDetails({ input }: { input: unknown }) {
  const config = (input ?? {}) as ConfigInput;
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
      <dt className="text-muted-foreground">Interview</dt>
      <dd className="text-foreground">{config.enabled ? "On" : "Off"}</dd>
      <dt className="text-muted-foreground">Invites</dt>
      <dd className="text-foreground">
        {config.inviteRule === "manual"
          ? "Only people you invite"
          : `Applicants scoring at least ${config.fitThreshold ?? 70}`}
      </dd>
      <dt className="text-muted-foreground">Competencies</dt>
      <dd className="text-foreground">
        <ul className="flex flex-col gap-1">
          {(config.competencies ?? []).map((c) => (
            <li key={c.name}>
              <span className="font-medium">{c.name}</span>
              {c.description && <span className="block text-muted-foreground">{c.description}</span>}
            </li>
          ))}
        </ul>
      </dd>
      <dt className="text-muted-foreground">Must-ask</dt>
      <dd className="text-foreground">
        {config.questions && config.questions.length > 0 ? (
          <ul className="flex flex-col gap-0.5">
            {config.questions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        ) : (
          "None"
        )}
      </dd>
      <dt className="text-muted-foreground">Length</dt>
      <dd className="text-foreground">{config.durationMinutes} minutes</dd>
      <dt className="text-muted-foreground">Deadline</dt>
      <dd className="text-foreground">{config.deadlineDays} days</dd>
    </dl>
  );
}

/**
 * Who the agent's `inviteToInterview` call invites, for its approval card
 * (§3.5): the applicants by name, anyone it would skip and why, and the
 * interview minutes it holds. The preview comes from the server.
 */
export function InterviewInviteApprovalDetails({ input }: { input: unknown }) {
  const [preview, setPreview] = useState<PreviewAgentInterviewInviteResult | null>(null);
  const key = JSON.stringify(input ?? null);

  useEffect(() => {
    let cancelled = false;
    previewAgentInterviewInviteAction(JSON.parse(key))
      .then((result) => !cancelled && setPreview(result))
      .catch(() => !cancelled && setPreview({ ok: false, error: "Couldn't load the preview." }));
    return () => {
      cancelled = true;
    };
  }, [key]);

  if (!preview) return <p className="text-xs text-muted-foreground">Loading the preview…</p>;
  if (!preview.ok) return <p className="text-xs text-destructive">These invites won&apos;t go through: {preview.error}</p>;

  const inviting = preview.applicants.filter((a) => a.invite);
  const skipping = preview.applicants.filter((a) => !a.invite);
  return (
    <div className="flex flex-col gap-2 text-xs">
      {inviting.length > 0 ? (
        <ul className="flex flex-col gap-0.5">
          {inviting.map((a) => (
            <li key={a.id}>
              {a.name ?? "Applicant"}
              {a.jobTitle && <span className="text-muted-foreground"> · {a.jobTitle}</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-destructive">Nobody here can be invited.</p>
      )}
      {skipping.length > 0 && (
        <ul className="flex flex-col gap-0.5 text-muted-foreground">
          {skipping.map((a) => (
            <li key={a.id}>
              {a.name ?? "Applicant"}: {"message" in a ? a.message : ""}
            </li>
          ))}
        </ul>
      )}
      <p className="text-muted-foreground">
        Holds up to {preview.totalMinutes} interview minutes, charged only for completed interviews. Each applicant gets
        an email with a link and a deadline.
      </p>
    </div>
  );
}
