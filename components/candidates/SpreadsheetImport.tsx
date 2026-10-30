"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download, FileSpreadsheet, Loader2 } from "lucide-react";
import toast from "react-hot-toast";
import { checkImportEmailsAction } from "@/app/actions/candidates/check-import-emails";
import { confirmSpreadsheetImportAction } from "@/app/actions/candidates/confirm-spreadsheet-import";
import { getImportMappingAction } from "@/app/actions/candidates/import-mapping";
import { startImportAction } from "@/app/actions/candidates/start-import";
import ColumnMapper from "@/components/candidates/ColumnMapper";
import ImportDestination, {
  destinationReady,
  destinationValue,
  initialDestination,
  type Destination,
} from "@/components/candidates/ImportDestination";
import ImportPreviewGrid, { type GridField } from "@/components/candidates/ImportPreviewGrid";
import LawfulBasisCheck from "@/components/candidates/LawfulBasisCheck";
import StickyActionBar from "@/components/StickyActionBar";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CANDIDATE_FIELD_KEYS } from "@/helpers/candidates/candidate-schema";
import type { ImportCounts } from "@/helpers/candidates/copy";
import type { ImportPage } from "@/helpers/candidates/import-page";
import { templateCsv, TEMPLATE_FILE_NAME } from "@/helpers/candidates/import-template";
import {
  applyMapping,
  guessMapping,
  headerHash,
  mappingProblem,
  sanitizeMapping,
  type ColumnMapping,
  type MappedRow,
} from "@/helpers/candidates/map-columns";
import { parseSheet, SheetError, type ParsedSheet } from "@/helpers/candidates/parse-sheet";
import { CANDIDATES_LIST_PATH } from "@/helpers/candidates/paths";
import {
  IMPORTED_STATUSES,
  previewRows,
  rowsToConfirm,
  type DuplicateAction,
  type EmailMatches,
} from "@/helpers/candidates/preview-rows";
import { matchStages, stageMapOf, stageValues, type StageChoices } from "@/helpers/candidates/stage-map";

type Step = "upload" | "map" | "review" | "done";

type Result = {
  counts: ImportCounts;
  jobId: string | null;
  list: { name: string; slug: string } | null;
};

const NO_MATCHES: EmailMatches = { existing: [], known: [] };

function downloadTemplate() {
  const url = URL.createObjectURL(new Blob([templateCsv()], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = TEMPLATE_FILE_NAME;
  a.click();
  URL.revokeObjectURL(url);
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** The confirmation counts (BI-REQ-017/019), skipping zeros. */
export function resultLines(counts: ImportCounts): string[] {
  return [
    counts.created ? `${plural(counts.created, "candidate", "candidates")} created` : null,
    counts.updated ? `${plural(counts.updated, "candidate", "candidates")} updated` : null,
    counts.skipped ? `${plural(counts.skipped, "existing candidate", "existing candidates")} left as they were` : null,
    counts.known ? `${plural(counts.known, "person", "people")} already in your pipeline on GetHired` : null,
    counts.added_to_list ? `${counts.added_to_list.toLocaleString("en-US")} added to the list` : null,
    counts.added_to_job ? `${counts.added_to_job.toLocaleString("en-US")} added to the job` : null,
    counts.already_in_job ? `${counts.already_in_job.toLocaleString("en-US")} already in the job` : null,
    counts.needs_outreach
      ? `${plural(counts.needs_outreach, "person", "people")} on GetHired to reach through outreach`
      : null,
    counts.no_email ? `${plural(counts.no_email, "candidate", "candidates")} not added to the job: no email` : null,
  ].filter((line): line is string => line !== null);
}

/**
 * The spreadsheet import (BI-REQ-010–019, CP-REQ-010): upload a CSV or XLSX,
 * map its columns, fix rows in the preview, pick where everyone goes (on a
 * job page, its `fixedJob`), attest the lawful basis and confirm. The file
 * is read in the browser and never uploaded (BI-DEC-004); the server checks
 * every row again.
 */
export default function SpreadsheetImport({ page }: { page: ImportPage }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("upload");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [sheet, setSheet] = useState<ParsedSheet | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  const [columns, setColumns] = useState<ColumnMapping>([]);
  const [savedStageMap, setSavedStageMap] = useState<Record<string, string>>({});

  const [rows, setRows] = useState<MappedRow[]>([]);
  const [matches, setMatches] = useState<EmailMatches>(NO_MATCHES);
  const [destination, setDestination] = useState<Destination>(() => initialDestination(page));
  const [stageChoices, setStageChoices] = useState<StageChoices>({});
  const [overrides, setOverrides] = useState<Record<number, DuplicateAction>>({});
  const [attested, setAttested] = useState(false);
  const [basisNote, setBasisNote] = useState("");
  const [batchId, setBatchId] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  const canUseJob = page.jobs.length > 0 || !!page.fixedJob;
  const withJob = destination.jobId !== null;
  const preview = useMemo(() => previewRows(rows, { matches, withJob }), [rows, matches, withJob]);
  const values = useMemo(() => (withJob ? stageValues(rows) : []), [rows, withJob]);
  const fields = useMemo<GridField[]>(() => {
    const mapped = new Set<string>(columns);
    if (columns.includes("first_name") || columns.includes("last_name")) mapped.add("full_name");
    if (columns.includes("tag")) mapped.add("tags");
    if (columns.includes("note")) mapped.add("notes");
    return [...CANDIDATE_FIELD_KEYS.filter((k) => mapped.has(k)), ...(withJob && mapped.has("stage") ? ["stage" as const] : [])];
  }, [columns, withJob]);
  const importable = preview.rows.filter((r) => IMPORTED_STATUSES.includes(r.status)).length;

  const read = async (picked: File, sheetName?: string) => {
    setBusy(true);
    setError(null);
    try {
      const parsed = await parseSheet(picked, { sheet: sheetName });
      const nextHash = await headerHash(parsed.headers);
      const saved = await getImportMappingAction({ headerHash: nextHash }).catch(() => null);
      const savedMapping = saved?.ok ? saved.mapping : null;
      let mapping = savedMapping ? sanitizeMapping(parsed.headers, savedMapping.columns) : guessMapping(parsed.headers);
      if (!canUseJob) mapping = mapping.map((t) => (t === "stage" ? "ignore" : t));
      setFile(picked);
      setSheet(parsed);
      setHash(nextHash);
      setColumns(mapping);
      setSavedStageMap(savedMapping?.stageMap ?? {});
      setBatchId(null);
      setStep("map");
    } catch (err) {
      setError(err instanceof SheetError ? err.message : "Couldn't read this file. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const toPreview = async () => {
    if (!sheet) return;
    setBusy(true);
    try {
      const mapped = applyMapping(sheet.rows, sheet.headers, columns);
      const emails = mapped.flatMap((r) => (r.email ? [r.email] : []));
      const checked = await checkImportEmailsAction({ emails });
      if (!checked.ok) {
        toast.error(checked.error);
        return;
      }
      setRows(mapped);
      setMatches({ existing: checked.existing, known: checked.known });
      setOverrides({});
      setStageChoices(matchStages(stageValues(mapped), page.stages, savedStageMap));
      setStep("review");
    } catch {
      toast.error("Couldn't check the emails. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const edit = useCallback((index: number, field: GridField, value: string) => {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
    // A new email may already be someone's (BI-REQ-014/019). Extra: the confirm checks again.
    if (field === "email" && value.includes("@")) {
      checkImportEmailsAction({ emails: [value] })
        .then((checked) => {
          if (!checked.ok) return;
          setMatches((m) => ({ existing: [...m.existing, ...checked.existing], known: [...m.known, ...checked.known] }));
        })
        .catch(() => {});
    }
  }, []);
  const override = useCallback(
    (index: number, action: DuplicateAction) => setOverrides((o) => ({ ...o, [index]: action })),
    [],
  );

  const listReady = destinationReady(destination);
  const confirm = async () => {
    if (!file || !hash) return;
    setBusy(true);
    try {
      let id = batchId;
      if (!id) {
        const started = await startImportAction({ fileName: file.name.slice(0, 255) });
        if (!started.ok) {
          toast.error(started.error);
          return;
        }
        id = started.batchId;
        setBatchId(id);
      }
      const target = destinationValue(page, destination);
      const jobId = target.jobPostId;
      const stageMap = jobId && values.length > 0 ? stageMapOf(stageChoices) : undefined;
      const confirmed = await confirmSpreadsheetImportAction({
        batchId: id,
        rows: rowsToConfirm(preview, { overrides, defaultAction: destination.duplicateAction }),
        duplicateAction: destination.duplicateAction,
        ...(jobId
          ? {
              jobPostId: jobId,
              ...(target.stageId ? { stageId: target.stageId } : {}),
              ...(stageMap ? { stageMap } : {}),
              autoInvite: target.autoInvite,
            }
          : {}),
        ...(target.newListName
          ? { newListName: target.newListName }
          : target.talentListId
            ? { talentListId: target.talentListId }
            : {}),
        attested,
        ...(basisNote.trim() ? { lawfulBasisNote: basisNote.trim() } : {}),
        mapping: { headerHash: hash, columns },
      });
      if (!confirmed.ok) {
        toast.error(confirmed.error);
        return;
      }
      const list =
        confirmed.newList ??
        (target.talentListId ? (page.lists?.find((l) => l.id === target.talentListId) ?? null) : null);
      setResult({ counts: confirmed.counts, jobId, list });
      setStep("done");
      router.refresh();
    } catch {
      toast.error("Couldn't finish the import. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setStep("upload");
    setFile(null);
    setSheet(null);
    setRows([]);
    setResult(null);
    setAttested(false);
    setBasisNote("");
    setBatchId(null);
    setDestination(initialDestination(page));
  };

  if (step === "done" && result) {
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
          <Button asChild variant="outline">
            <Link href={CANDIDATES_LIST_PATH}>Candidates</Link>
          </Button>
          {result.list && (
            <Button asChild variant="outline">
              <Link href={`/company/profiles?tab=${encodeURIComponent(result.list.slug)}`}>Open {result.list.name}</Link>
            </Button>
          )}
          {result.jobId && (
            <Button asChild variant="outline">
              <Link href={`/company/job-posts/${result.jobId}/applications`}>Open the job&apos;s applications</Link>
            </Button>
          )}
          <Button variant="ghost" onClick={reset}>
            Import more
          </Button>
        </div>
      </section>
    );
  }

  if (step === "upload" || !sheet) {
    return (
      <section className="flex flex-col gap-4" aria-label="Upload">
        <div className="flex flex-col gap-3 rounded-xl border border-dashed p-6">
          <div className="flex items-center gap-2 text-sm font-medium">
            <FileSpreadsheet className="h-4 w-4" aria-hidden />
            <label htmlFor="import-file">Choose a .csv or .xlsx file</label>
          </div>
          <p className="text-sm text-muted-foreground">
            Up to 5,000 people and 10 MB. The first row is the header. The file stays in your browser; only the rows you
            confirm are saved.
          </p>
          <input
            id="import-file"
            type="file"
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            disabled={busy}
            onChange={(event) => {
              const picked = event.target.files?.[0];
              event.target.value = "";
              if (picked) void read(picked);
            }}
            className="w-full cursor-pointer rounded-lg border bg-background p-3 text-sm text-muted-foreground file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed"
          />
          {busy && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Reading the file…
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <div>
          <Button type="button" variant="outline" onClick={downloadTemplate}>
            <Download className="mr-2 h-4 w-4" aria-hidden />
            Download the template
          </Button>
        </div>
      </section>
    );
  }

  if (step === "map") {
    const problem = mappingProblem(columns);
    return (
      <div className="flex flex-col gap-6">
        <section className="flex flex-col gap-4" aria-label="Columns">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">Match the columns</h2>
              <p className="text-sm text-muted-foreground">
                {file?.name}: {plural(sheet.rows.length, "row", "rows")}. Columns you don&apos;t need can be ignored, or
                kept as tags or notes.
              </p>
            </div>
            {sheet.sheets && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="import-sheet">Sheet</Label>
                <Select value={sheet.sheet} onValueChange={(name) => file && void read(file, name)} disabled={busy}>
                  <SelectTrigger id="import-sheet" aria-label="Sheet" className="w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {sheet.sheets.map((name) => (
                      <SelectItem key={name} value={name}>
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <ColumnMapper
            headers={sheet.headers}
            samples={sheet.rows.slice(0, 3)}
            columns={columns}
            onChange={setColumns}
            allowStage={canUseJob}
            disabled={busy}
          />
          {problem && <p className="text-sm text-destructive">{problem}</p>}
        </section>
        <StickyActionBar className="justify-end">
          <Button type="button" variant="outline" disabled={busy} onClick={reset}>
            Choose another file
          </Button>
          <Button type="button" disabled={busy || problem !== null} onClick={() => void toPreview()}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Preview rows
          </Button>
        </StickyActionBar>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4" aria-label="Destination">
        <h2 className="text-lg font-semibold">Where they go</h2>
        <ImportDestination
          page={page}
          value={destination}
          onChange={setDestination}
          stageValues={values}
          stageChoices={stageChoices}
          onStageChoicesChange={setStageChoices}
          jobPreview={preview.job}
          disabled={busy}
        />
      </section>

      <section className="flex flex-col gap-4 border-t pt-6" aria-label="Preview">
        <div>
          <h2 className="text-lg font-semibold">Check the rows</h2>
          <p className="text-sm text-muted-foreground">
            Fix a highlighted cell to import that row. Rows that still have errors, and repeats of an email earlier in
            the file, are skipped.
          </p>
        </div>
        <ImportPreviewGrid
          preview={preview}
          rows={rows}
          fields={fields}
          overrides={overrides}
          defaultAction={destination.duplicateAction}
          onEdit={edit}
          onOverride={override}
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
        />
      </section>

      <StickyActionBar className="justify-end">
        <Button type="button" variant="outline" disabled={busy} onClick={() => setStep("map")}>
          Back to columns
        </Button>
        <Button
          type="button"
          variant="brand"
          disabled={busy || !attested || importable === 0 || !listReady}
          onClick={() => void confirm()}
        >
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Import {plural(importable, "person", "people")}
        </Button>
      </StickyActionBar>
    </div>
  );
}
