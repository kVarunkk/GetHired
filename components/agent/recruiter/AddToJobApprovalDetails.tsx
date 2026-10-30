"use client";

import { useEffect, useState } from "react";
import { previewAgentAddToJobAction, type AddToJobPreview } from "@/app/actions/candidates/preview-agent-add-to-job";

/**
 * The approval card's details for the agent's `addCandidatesToJob` (CPT-058):
 * the job and stage by name, and who'd be added, from a server preview, so
 * the user approves names rather than ids.
 */
export function AddToJobApprovalDetails({ input }: { input: unknown }) {
  const [preview, setPreview] = useState<AddToJobPreview | null>(null);
  const key = JSON.stringify(input ?? null);

  useEffect(() => {
    let cancelled = false;
    previewAgentAddToJobAction(JSON.parse(key))
      .then((result) => !cancelled && setPreview(result))
      .catch(() => !cancelled && setPreview({ ok: false, error: "Couldn't load the preview." }));
    return () => {
      cancelled = true;
    };
  }, [key]);

  if (!preview) return <p className="text-xs text-muted-foreground">Loading the preview…</p>;
  if (!preview.ok) return <p className="text-xs text-destructive">This won&apos;t go through: {preview.error}</p>;

  const adding = preview.candidates.filter((c) => c.hasEmail);
  const skipping = preview.candidates.filter((c) => !c.hasEmail);
  return (
    <div className="flex flex-col gap-2 text-xs">
      <p>
        Into <span className="font-medium">{preview.jobTitle}</span>
        {preview.stageName ? `, stage ${preview.stageName}` : ", its first stage"}.
      </p>
      {adding.length > 0 ? (
        <ul className="flex flex-col gap-0.5">
          {adding.map((c) => (
            <li key={c.id}>{c.name}</li>
          ))}
        </ul>
      ) : (
        <p className="text-destructive">Nobody here can be added.</p>
      )}
      {(skipping.length > 0 || preview.notFound > 0) && (
        <ul className="flex flex-col gap-0.5 text-muted-foreground">
          {skipping.map((c) => (
            <li key={c.id}>{c.name}: no email, won&apos;t be added</li>
          ))}
          {preview.notFound > 0 && <li>{preview.notFound} not found</li>}
        </ul>
      )}
    </div>
  );
}
