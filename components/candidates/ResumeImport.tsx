"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import toast from "react-hot-toast";
import { checkImportEmailsAction } from "@/app/actions/candidates/check-import-emails";
import { confirmResumeImportAction } from "@/app/actions/candidates/confirm-resume-import";
import { importStatusAction } from "@/app/actions/candidates/import-status";
import { removeImportRowAction } from "@/app/actions/candidates/remove-import-row";
import { retryImportRowAction } from "@/app/actions/candidates/retry-import-row";
import { updateImportRowAction } from "@/app/actions/candidates/update-import-row";
import ImportDestination, {
  destinationJob,
  destinationReady,
  destinationValue,
  initialDestination,
  type Destination,
  type DestinationPage,
} from "@/components/candidates/ImportDestination";
import LawfulBasisCheck from "@/components/candidates/LawfulBasisCheck";
import ResumeDropzone from "@/components/candidates/ResumeDropzone";
import ResumeReviewGrid, { type KnownUsers, type ResumeGridField } from "@/components/candidates/ResumeReviewGrid";
import { resultLines } from "@/components/candidates/SpreadsheetImport";
import { failureOf, uploadResumeBatch } from "@/components/candidates/upload-resume-batch";
import StickyActionBar from "@/components/StickyActionBar";
import { Button } from "@/components/ui/button";
import type { ImportCounts } from "@/helpers/candidates/copy";
import { isInFlight, needsEmail, type ImportBatchView, type ImportRowView } from "@/helpers/candidates/import-rows";
import { CANDIDATES_LIST_PATH } from "@/helpers/candidates/paths";
import type { DuplicateAction } from "@/helpers/candidates/preview-rows";

const POLL_MS = 3000;

type Result = {
  counts: ImportCounts;
  batchId: string;
  jobId: string | null;
  list: { name: string; slug: string } | null;
};

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** The destination an open batch was given, over where an import starts (CP-REQ-011). */
function destinationOf(page: DestinationPage, batch: ImportBatchView | null): Destination {
  const start = initialDestination(page);
  if (!batch) return start;
  const job = batch.jobPostId && (page.fixedJob?.id === batch.jobPostId || page.jobs.some((j) => j.id === batch.jobPostId));
  const list = batch.talentListId && page.lists?.some((l) => l.id === batch.talentListId) ? batch.talentListId : null;
  if (job) {
    return { ...start, kind: "job", jobId: batch.jobPostId, stageId: batch.stageId, autoInvite: batch.autoInvite, list };
  }
  if (list && page.allowNoJob) return { ...start, kind: "list", jobId: null, list };
  return start;
}

/**
 * The resume import (BI-REQ-020–025, CP-REQ-002/010/011/023): upload up to
 * 100 resumes, wait while they're read, fix what was read, pick where they
 * go (on a job page, `page.fixedJob`; elsewhere your candidates, a talent
 * list or a job, changeable until Confirm), attest the lawful basis and
 * confirm. Everyone needs an email only when they go to a job. Files go
 * straight to Storage through signed URLs; the worker reads them.
 * `initial` resumes an import after a reload.
 */
export default function ResumeImport({
  page,
  initial = null,
}: {
  page: DestinationPage;
  initial?: { batch: ImportBatchView; rows: ImportRowView[] } | null;
}) {
  const router = useRouter();
  const [batch, setBatch] = useState<ImportBatchView | null>(initial?.batch ?? null);
  const [rows, setRows] = useState<ImportRowView[]>(initial?.rows ?? []);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [known, setKnown] = useState<KnownUsers>(() => new Map());
  const checked = useRef(new Set<string>());

  const [destination, setDestination] = useState<Destination>(() => destinationOf(page, initial?.batch ?? null));
  const [attested, setAttested] = useState(false);
  const [basisNote, setBasisNote] = useState("");
  const [result, setResult] = useState<Result | null>(null);

  const batchId = batch?.id ?? null;
  const reading = rows.some(isInFlight);
  const job = destinationJob(page, destination);

  const refresh = useCallback(async () => {
    if (!batchId) return;
    const status = await importStatusAction({ batchId }).catch(() => null);
    if (!status?.ok) return;
    setBatch(status.batch);
    setRows(status.rows);
  }, [batchId]);

  // BI-REQ-023: the grid fills in as the worker reads each file.
  useEffect(() => {
    if (!batchId || !reading) return;
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [batchId, reading, refresh]);

  // BI-REQ-019: people already on GetHired and in the pipeline aren't imported.
  useEffect(() => {
    const emails = rows
      .filter((r) => r.status === "parsed" && typeof r.fields.email === "string")
      .map((r) => (r.fields.email as string).trim().toLowerCase())
      .filter((e) => e.includes("@") && !checked.current.has(e));
    if (emails.length === 0) return;
    for (const e of emails) checked.current.add(e);
    checkImportEmailsAction({ emails })
      .then((res) => {
        if (!res.ok || res.known.length === 0) return;
        setKnown((current) => {
          const next = new Map(current);
          for (const k of res.known) next.set(k.email.toLowerCase(), { userId: k.userId, fullName: k.fullName });
          return next;
        });
      })
      .catch(() => {});
  }, [rows]);

  const upload = async (files: File[]) => {
    setBusy(true);
    setUploadError(null);
    try {
      // A job page's batch is for its job. Elsewhere it starts in the pool and
      // gets its destination at Confirm (CP-REQ-011), unless the member can only
      // import into their jobs.
      const startJob = page.fixedJob?.id ?? (page.allowNoJob ? null : destination.jobId);
      const uploaded = await uploadResumeBatch(files, { jobPostId: startJob, onProgress: setProgress });
      if (!uploaded.ok) {
        setUploadError(uploaded.error);
        return;
      }
      setBatch({
        id: uploaded.batchId,
        status: "parsing",
        jobPostId: startJob,
        talentListId: null,
        stageId: null,
        autoInvite: false,
        expiresAt: "",
      });
      const status = await importStatusAction({ batchId: uploaded.batchId });
      if (status.ok) {
        setBatch(status.batch);
        setRows(status.rows);
      }
    } catch {
      setUploadError("Couldn't upload the resumes. Try again.");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const edit = useCallback(
    (rowId: string, field: ResumeGridField, value: string) => {
      setRows((current) =>
        current.map((r) =>
          r.id === rowId
            ? {
                ...r,
                fields: { ...r.fields, [field]: value },
                edited: { ...r.edited, [field]: value },
                warnings: r.warnings.filter((w) => w.field !== field),
              }
            : r,
        ),
      );
      updateImportRowAction({ rowId, fields: { [field]: value } })
        .then((res) => {
          if (res.ok) return;
          toast.error(res.errors?.[field] ?? res.error);
          void refresh();
        })
        .catch(() => {
          toast.error("Couldn't save. Try again.");
          void refresh();
        });
    },
    [refresh],
  );

  const setDuplicateAction = useCallback((rowId: string, action: DuplicateAction) => {
    setRows((current) => current.map((r) => (r.id === rowId ? { ...r, duplicateAction: action } : r)));
    updateImportRowAction({ rowId, duplicateAction: action })
      .then((res) => {
        if (!res.ok) toast.error(res.error);
      })
      .catch(() => toast.error("Couldn't save. Try again."));
  }, []);

  const retry = useCallback(
    (rowId: string) => {
      retryImportRowAction({ rowId })
        .then((res) => {
          const failure = failureOf(res);
          if (failure) toast.error(failure);
          void refresh();
        })
        .catch(() => toast.error("Couldn't try again. Try once more."));
    },
    [refresh],
  );

  const remove = useCallback((rowId: string) => {
    setRows((current) => current.filter((r) => r.id !== rowId));
    removeImportRowAction({ rowId })
      .then((res) => {
        if (!res.ok) toast.error(res.error);
      })
      .catch(() => toast.error("Couldn't remove the file. Try again."));
  }, []);

  const parsed = rows.filter((r) => r.status === "parsed");
  const importable = parsed.filter((r) => {
    const email = typeof r.fields.email === "string" ? r.fields.email.trim().toLowerCase() : "";
    return !known.has(email);
  }).length;
  // BI-DEC-010: only a job needs everyone's email (CP-REQ-002).
  const missingEmail = job ? parsed.filter(needsEmail).length : 0;
  const failed = rows.filter((r) => r.status === "failed").length;
  const hasDuplicates = parsed.some((r) => r.duplicateOf);

  const rowActions = useMemo(
    () =>
      parsed.flatMap((r) =>
        r.duplicateOf && r.duplicateAction ? [{ rowId: r.id, duplicateAction: r.duplicateAction }] : [],
      ),
    [parsed],
  );

  const confirm = async () => {
    if (!batchId) return;
    setBusy(true);
    try {
      const target = destinationValue(page, destination);
      const confirmed = await confirmResumeImportAction({
        batchId,
        // A job page's batch keeps its job; elsewhere the destination is sent.
        ...(page.fixedJob ? {} : { jobPostId: target.jobPostId }),
        ...(target.newListName
          ? { newListName: target.newListName }
          : { talentListId: target.talentListId ?? null }),
        stageId: target.stageId,
        duplicateAction: destination.duplicateAction,
        rowActions,
        autoInvite: target.autoInvite,
        attested,
        ...(basisNote.trim() ? { lawfulBasisNote: basisNote.trim() } : {}),
      });
      if (!confirmed.ok) {
        toast.error(confirmed.error);
        if (confirmed.rowIds?.length) void refresh();
        return;
      }
      setResult({ counts: confirmed.counts, batchId, jobId: confirmed.jobPostId, list: confirmed.list });
      router.refresh();
    } catch {
      toast.error("Couldn't finish the import. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setBatch(null);
    setRows([]);
    setResult(null);
    setAttested(false);
    setBasisNote("");
    setDestination(initialDestination(page));
  };

  if (result) {
    const lines = resultLines(result.counts);
    return (
      <section className="flex flex-col gap-4 rounded-xl border p-6" aria-label="Import result">
        <h2 className="text-lg font-semibold">Import finished</h2>
        <ul className="list-inside list-disc text-sm">
          {(lines.length ? lines : ["Nothing changed."]).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          {result.jobId ? (
            <Button asChild variant="outline">
              <Link href={`/company/job-posts/${result.jobId}/applications`}>Open the job&apos;s applications</Link>
            </Button>
          ) : (
            <Button asChild variant="outline">
              <Link href={`${CANDIDATES_LIST_PATH}?batch=${encodeURIComponent(result.batchId)}`}>
                See them in Candidates
              </Link>
            </Button>
          )}
          {result.list && (
            <Button asChild variant="outline">
              <Link href={`/company/profiles?tab=${encodeURIComponent(result.list.slug)}`}>Open {result.list.name}</Link>
            </Button>
          )}
          <Button variant="ghost" onClick={reset}>
            Import more
          </Button>
        </div>
      </section>
    );
  }

  if (!batch) {
    return <ResumeDropzone onSubmit={(files) => void upload(files)} busy={busy} progress={progress} error={uploadError} />;
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4" aria-label="Resumes">
        <div>
          <h2 className="text-lg font-semibold">Check what was read</h2>
          <p className="text-sm text-muted-foreground" role="status">
            {reading
              ? `Reading ${plural(rows.filter(isInFlight).length, "resume", "resumes")}. You can fix the ones that are done.`
              : `${plural(parsed.length, "resume", "resumes")} read${failed ? `, ${failed} failed` : ""}. Fix a highlighted cell, or remove the row.`}
          </p>
        </div>
        <ResumeReviewGrid
          rows={rows}
          known={known}
          defaultAction={destination.duplicateAction}
          onEdit={edit}
          onDuplicateAction={setDuplicateAction}
          onRetry={retry}
          onRemove={remove}
          emailRequired={!!job}
          disabled={busy}
        />
      </section>

      <section className="flex flex-col gap-4 border-t pt-6" aria-label="Destination">
        <h2 className="text-lg font-semibold">Where they go</h2>
        <ImportDestination
          page={page}
          value={destination}
          onChange={setDestination}
          showDuplicateAction={hasDuplicates}
          idPrefix="resume-import"
          disabled={busy}
        />
      </section>

      <section className="border-t pt-6" aria-label="Lawful basis">
        <LawfulBasisCheck
          attested={attested}
          onAttestedChange={setAttested}
          note={basisNote}
          onNoteChange={setBasisNote}
          disabled={busy}
          idPrefix="resume-import"
        />
      </section>

      <StickyActionBar className="justify-end">
        {missingEmail > 0 && (
          <span className="mr-auto text-sm text-destructive">
            {plural(missingEmail, "person needs", "people need")} an email to join the job.
          </span>
        )}
        <Button
          type="button"
          variant="brand"
          disabled={
            busy || reading || !attested || importable === 0 || missingEmail > 0 || !destinationReady(destination)
          }
          onClick={() => void confirm()}
        >
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Import {plural(importable, "person", "people")}
        </Button>
      </StickyActionBar>
    </div>
  );
}
