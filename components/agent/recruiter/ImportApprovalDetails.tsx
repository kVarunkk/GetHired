"use client";

import { useEffect, useState } from "react";
import { previewAgentAddCandidateAction, previewAgentDeleteCandidatesAction, previewAgentImportAction } from "@/app/actions/candidates/preview-agent-import";
import type { AddCandidatePreview, DeleteCandidatesPreview, DestinationPreview, ImportPreview } from "@/helpers/candidates/preview-agent-import";

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** A server preview for an approval card, reloaded when the proposed input changes. */
function usePreview<T>(load: (input: unknown) => Promise<T>, input: unknown, failed: T): T | null {
  const [preview, setPreview] = useState<T | null>(null);
  const key = JSON.stringify(input ?? null);
  useEffect(() => {
    let cancelled = false;
    setPreview(null);
    load(JSON.parse(key))
      .then((result) => !cancelled && setPreview(result))
      .catch(() => !cancelled && setPreview(failed));
    return () => {
      cancelled = true;
    };
    // `load` and `failed` are module constants at every call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return preview;
}

const LOAD_FAILED = { ok: false as const, error: "Couldn't load the preview." };

/**
 * BI-REQ-016: approving an import or a hand-added person is the member's
 * attestation, so the card says so in the import page's words.
 */
export function LawfulBasisNotice({ input }: { input: unknown }) {
  const note = (input as { lawfulBasisNote?: unknown } | undefined)?.lawfulBasisNote;
  return (
    <p className="text-xs text-muted-foreground">
      By approving, you confirm we have a lawful basis to process these people&apos;s data and to contact them about
      roles{typeof note === "string" && note.trim() ? ` (${note.trim()})` : ""}. No one is emailed.
    </p>
  );
}

function Destination({ preview }: { preview: DestinationPreview }) {
  const parts = [
    "your candidates",
    preview.listName && `${preview.newList ? "a new list, " : "the list "}${preview.listName}`,
    preview.jobTitle && `${preview.jobTitle} (${preview.stageName ? `stage ${preview.stageName}` : "its first stage"})`,
  ].filter(Boolean);
  return (
    <p>
      Into <span className="font-medium">{parts.join(", ")}</span>.
    </p>
  );
}

/** The card's details for the agent's `confirmImport`: the file, the destination and the counts. */
export function ImportApprovalDetails({ input }: { input: unknown }) {
  const preview = usePreview<ImportPreview>(previewAgentImportAction, input, LOAD_FAILED);
  if (!preview) return <p className="text-xs text-muted-foreground">Loading the preview…</p>;
  if (!preview.ok) return <p className="text-xs text-destructive">This won&apos;t go through: {preview.error}</p>;

  return (
    <div className="flex flex-col gap-2 text-xs">
      {preview.fileName && <p className="break-words text-muted-foreground">{preview.fileName}</p>}
      <Destination preview={preview} />
      <ul className="flex flex-col gap-0.5">
        <li>{plural(preview.importing, "person", "people")} in this import</li>
        {preview.existing > 0 && <li>{plural(preview.existing, "is already a candidate", "are already candidates")}</li>}
        {preview.known > 0 && <li>{preview.known} already on GetHired: linked, not imported again</li>}
        {preview.noEmailForJob > 0 && <li>{preview.noEmailForJob} without an email won&apos;t be added to the job</li>}
      </ul>
      {(preview.leftOut > 0 || preview.reading > 0) && (
        <p className="text-muted-foreground">
          {preview.leftOut > 0 && `${plural(preview.leftOut, "row", "rows")} left out (needs a fix, failed or a repeat). `}
          {preview.reading > 0 && `${preview.reading} still being read won't be included.`}
        </p>
      )}
      {preview.missingEmail > 0 && (
        <p className="text-destructive">
          {plural(preview.missingEmail, "resume has", "resumes have")} no email. Everyone going into a job needs one: add
          them or remove those rows first.
        </p>
      )}
    </div>
  );
}

/** The card's details for the agent's `addCandidate`: who, and where they go. */
export function AddCandidateApprovalDetails({ input }: { input: unknown }) {
  const preview = usePreview<AddCandidatePreview>(previewAgentAddCandidateAction, input, LOAD_FAILED);
  if (!preview) return <p className="text-xs text-muted-foreground">Loading the preview…</p>;
  if (!preview.ok) return <p className="text-xs text-destructive">This won&apos;t go through: {preview.error}</p>;
  return (
    <div className="text-xs">
      <Destination preview={preview} />
    </div>
  );
}

/** The card's details for the agent's `deleteMyCandidates`: who, by name. */
export function DeleteCandidatesApprovalDetails({ input }: { input: unknown }) {
  const preview = usePreview<DeleteCandidatesPreview>(previewAgentDeleteCandidatesAction, input, LOAD_FAILED);
  if (!preview) return <p className="text-xs text-muted-foreground">Loading the preview…</p>;
  if (!preview.ok) return <p className="text-xs text-destructive">This won&apos;t go through: {preview.error}</p>;
  return (
    <div className="flex flex-col gap-2 text-xs">
      <ul className="flex flex-col gap-0.5">
        {preview.candidates.map((c) => (
          <li key={c.id}>
            {c.name}
            {c.jobs > 0 && <span className="text-muted-foreground"> · in {plural(c.jobs, "job", "jobs")}</span>}
          </li>
        ))}
      </ul>
      {preview.notFound > 0 && <p className="text-muted-foreground">{preview.notFound} not found</p>}
      <p className="text-muted-foreground">
        Their imported applications, list places and resumes are deleted too. This can&apos;t be undone.
      </p>
    </div>
  );
}
