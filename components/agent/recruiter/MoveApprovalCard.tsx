"use client";

import { useEffect, useState } from "react";
import {
  previewAgentMoveAction,
  type PreviewAgentMoveResult,
} from "@/app/actions/pipeline/preview-agent-move";
import { statusForKind } from "@/helpers/pipeline/status-map";
import { statusLabel } from "./RecruiterResults";

/** Names shown before "and N more". */
const NAMES_SHOWN = 5;

/**
 * What an agent's stage move will do, for its approval card (RA-REQ-005,
 * RA spec §4.7): the stage, the status candidates will see, the applicants by
 * name, and the exact email and how many get it. The preview comes from the
 * server with the same checks as the move, so a move that would fail says so
 * here first.
 */
export function MoveApprovalDetails({ input }: { input: unknown }) {
  const [preview, setPreview] = useState<PreviewAgentMoveResult | null>(null);
  const [showAll, setShowAll] = useState(false);
  const key = JSON.stringify(input ?? null);

  useEffect(() => {
    let cancelled = false;
    previewAgentMoveAction(JSON.parse(key))
      .then((result) => !cancelled && setPreview(result))
      .catch(() => !cancelled && setPreview({ ok: false, error: "Couldn't load the preview." }));
    return () => {
      cancelled = true;
    };
  }, [key]);

  if (!preview) return <p className="text-xs text-muted-foreground">Loading the preview…</p>;
  if (!preview.ok) {
    return <p className="text-xs text-destructive">This move won&apos;t go through: {preview.error}</p>;
  }

  const moving = preview.applications.filter((a) => a.moves);
  const staying = preview.applications.length - moving.length;
  const names = showAll ? moving : moving.slice(0, NAMES_SHOWN);
  const hidden = moving.length - names.length;

  return (
    <div className="flex flex-col gap-3 text-xs">
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
        <dt className="text-muted-foreground">Stage</dt>
        <dd className="text-foreground">{preview.stage.name}</dd>
        <dt className="text-muted-foreground">Candidates see</dt>
        <dd className="text-foreground">{statusLabel(statusForKind(preview.stage.kind))}</dd>
        <dt className="text-muted-foreground">Applicants</dt>
        <dd className="text-foreground">
          {moving.length === 0 ? (
            "None: they're all in this stage already."
          ) : (
            <ul className="flex flex-col gap-0.5">
              {names.map((app) => (
                <li key={app.id}>
                  {app.name?.trim() || "Applicant"}
                  <span className="text-muted-foreground"> · {app.jobTitle}</span>
                </li>
              ))}
              {hidden > 0 && (
                <li>
                  <button
                    type="button"
                    className="text-muted-foreground underline underline-offset-4 hover:text-foreground"
                    onClick={() => setShowAll(true)}
                  >
                    and {hidden} more
                  </button>
                </li>
              )}
            </ul>
          )}
        </dd>
        {(staying > 0 || preview.notFound > 0) && (
          <>
            <dt className="text-muted-foreground">Skipped</dt>
            <dd className="text-foreground">
              {[
                staying > 0 && `${staying} already in this stage`,
                preview.notFound > 0 && `${preview.notFound} not found`,
              ]
                .filter(Boolean)
                .join(", ")}
            </dd>
          </>
        )}
        <dt className="text-muted-foreground">Email</dt>
        <dd className="text-foreground">
          {preview.email
            ? `${preview.email.recipients} ${preview.email.recipients === 1 ? "candidate" : "candidates"}`
            : "None"}
        </dd>
      </dl>
      {preview.email && (
        <div className="flex flex-col gap-1 rounded-lg border bg-background p-3">
          <p className="font-medium text-foreground">{preview.email.subject}</p>
          {/* Plain text: exactly what was written, nothing rendered or linked. */}
          <p className="whitespace-pre-wrap break-words text-muted-foreground">{preview.email.body}</p>
          {preview.email.recipients > 1 && (
            <p className="text-muted-foreground">
              Shown for the first candidate; names and job titles change per email.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
