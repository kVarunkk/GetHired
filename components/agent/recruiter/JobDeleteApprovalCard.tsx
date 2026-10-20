"use client";

import { useEffect, useState } from "react";
import {
  previewAgentJobDeleteAction,
  type PreviewAgentJobDeleteResult,
} from "@/app/actions/jobs/preview-agent-job-delete";

/**
 * What an agent's job post delete removes, for its approval card
 * (RA-REQ-005): the job by title, whether it's live and the applications that
 * go with it. The preview comes from the server with the delete's own checks,
 * so a delete that would fail says so here first.
 */
export function JobDeleteApprovalDetails({ input }: { input: unknown }) {
  const [preview, setPreview] = useState<PreviewAgentJobDeleteResult | null>(null);
  const key = JSON.stringify(input ?? null);

  useEffect(() => {
    let cancelled = false;
    previewAgentJobDeleteAction(JSON.parse(key))
      .then((result) => !cancelled && setPreview(result))
      .catch(() => !cancelled && setPreview({ ok: false, error: "Couldn't load the preview." }));
    return () => {
      cancelled = true;
    };
  }, [key]);

  if (!preview) return <p className="text-xs text-muted-foreground">Loading the preview…</p>;
  if (!preview.ok) {
    return <p className="text-xs text-destructive">This delete won&apos;t go through: {preview.error}</p>;
  }

  const applications = `${preview.applications} ${preview.applications === 1 ? "application" : "applications"}`;

  return (
    <div className="flex flex-col gap-3 text-xs">
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
        <dt className="text-muted-foreground">Job</dt>
        <dd className="break-words text-foreground">{preview.title}</dd>
        <dt className="text-muted-foreground">Status</dt>
        <dd className="text-foreground">{preview.status === "active" ? "Published" : "Not published"}</dd>
        <dt className="text-muted-foreground">Applications</dt>
        <dd className="text-foreground">{preview.applications === 0 ? "None" : applications}</dd>
      </dl>
      <p className="text-destructive">
        {preview.applications === 0
          ? "This can't be undone."
          : `The ${applications} and their notes are deleted too. This can't be undone.`}
      </p>
    </div>
  );
}
