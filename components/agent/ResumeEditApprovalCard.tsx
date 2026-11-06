"use client";

import { useEffect, useState } from "react";
import { previewAgentResumeEditAction } from "@/app/actions/resumes/preview-agent-resume-edit";
import type { ResumeEditPreview, ResumeEditTool } from "@/helpers/resumes/preview-resume-edit";

export const isResumeEditTool = (name: string): name is ResumeEditTool =>
  ["createResume", "updateResume", "deleteResume", "applyReviewSuggestions"].includes(name);

/**
 * What the agent's resume change will do, for its approval card, as a before and
 * after from the server (RE-REQ-072). A change that would fail says so here
 * first. Resume text renders as plain text.
 */
export function ResumeEditApprovalDetails({ tool, input }: { tool: ResumeEditTool; input: unknown }) {
  const [preview, setPreview] = useState<ResumeEditPreview | null>(null);
  const key = JSON.stringify(input ?? null);

  useEffect(() => {
    let cancelled = false;
    previewAgentResumeEditAction({ tool, input: JSON.parse(key) })
      .then((result) => !cancelled && setPreview(result))
      .catch(() => !cancelled && setPreview({ ok: false, error: "Couldn't load the preview." }));
    return () => {
      cancelled = true;
    };
  }, [tool, key]);

  if (!preview) return <p className="text-xs text-muted-foreground">Loading the preview…</p>;
  if (!preview.ok) return <p className="text-xs text-destructive">This won&apos;t go through: {preview.error}</p>;

  return (
    <div className="flex flex-col gap-2 text-xs">
      <p className="break-words text-foreground">{preview.summary}</p>
      {preview.changes.map(({ label, before, after }, index) => (
        <div key={`${label}-${index}`} className="flex flex-col gap-0.5 border-t pt-2">
          <p className="break-words text-muted-foreground">{label}</p>
          {before && <p className="whitespace-pre-line break-words text-muted-foreground line-through">{before}</p>}
          {after ? (
            <p className="whitespace-pre-line break-words text-foreground">{after}</p>
          ) : (
            <p className="text-muted-foreground">Removed</p>
          )}
        </div>
      ))}
    </div>
  );
}
