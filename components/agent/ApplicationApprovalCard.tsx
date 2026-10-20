"use client";

import { useEffect, useState } from "react";
import {
  previewAgentApplicationAction,
  type PreviewAgentApplicationResult,
} from "@/app/actions/applications/preview-agent-application";

/**
 * What the agent's application will send, for its approval card: the job,
 * the resume and every answer under the question's own label. The preview
 * comes from the server with the same checks as the submit, so an
 * application that would fail says so here first.
 */
export function ApplicationApprovalDetails({ input }: { input: unknown }) {
  const [preview, setPreview] = useState<PreviewAgentApplicationResult | null>(null);
  const key = JSON.stringify(input ?? null);

  useEffect(() => {
    let cancelled = false;
    previewAgentApplicationAction(JSON.parse(key))
      .then((result) => !cancelled && setPreview(result))
      .catch(() => !cancelled && setPreview({ ok: false, error: "Couldn't load the preview." }));
    return () => {
      cancelled = true;
    };
  }, [key]);

  if (!preview) return <p className="text-xs text-muted-foreground">Loading the preview…</p>;
  if (!preview.ok) {
    return (
      <div className="flex flex-col gap-1 text-xs text-destructive">
        <p>This application won&apos;t go through: {preview.error}</p>
        {preview.fieldErrors && preview.fieldErrors.length > 0 && (
          <ul className="flex flex-col gap-0.5">
            {preview.fieldErrors.map(({ label, error }) => (
              <li key={label} className="break-words">
                {label}: {error}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  const job = [preview.job.title, preview.job.company].filter(Boolean).join(" at ");

  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
      <dt className="text-muted-foreground">Job</dt>
      <dd className="break-words text-foreground">{job || "This job"}</dd>
      <dt className="text-muted-foreground">Resume</dt>
      <dd className="break-words text-foreground">{preview.resume ?? "Your resume"}</dd>
      {preview.answers.map(({ key, label, text }) => (
        <div key={key} className="contents">
          <dt className="max-w-48 break-words text-muted-foreground">{label}</dt>
          <dd className="whitespace-pre-line break-words text-foreground">
            {text ?? <span className="text-muted-foreground">Skipped</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}
