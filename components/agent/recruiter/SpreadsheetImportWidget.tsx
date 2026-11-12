"use client";

import { useId, useState } from "react";
import { FileSpreadsheet, Loader2 } from "lucide-react";
import { stageSpreadsheetImportAction } from "@/app/actions/candidates/stage-spreadsheet-import";
import ColumnMapper from "@/components/candidates/ColumnMapper";
import { loadSheet, sheetErrorMessage } from "@/components/candidates/load-sheet";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { applyMapping, mappingProblem, type ColumnMapping } from "@/helpers/candidates/map-columns";
import type { ParsedSheet } from "@/helpers/candidates/parse-sheet";

export type SpreadsheetImportOutput = { batchId: string; rows: number } | { cancelled: true };

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/**
 * The recruiter agent's `requestSpreadsheetImport` (BI-REQ-060): a CSV or
 * XLSX is read in the browser and its columns matched as on the import page
 * (BI-REQ-010/011), then the mapped rows are saved on a draft import so the
 * agent can review, fix and confirm them. Nobody is imported until the user
 * approves confirmImport; an unconfirmed import is deleted after 7 days.
 */
export default function SpreadsheetImportWidget({
  jobPostId,
  reason,
  onComplete,
}: {
  jobPostId?: string;
  reason?: string;
  onComplete: (output: SpreadsheetImportOutput) => void;
}) {
  const inputId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [sheet, setSheet] = useState<ParsedSheet | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  const [columns, setColumns] = useState<ColumnMapping>([]);

  const read = async (picked: File, sheetName?: string) => {
    setBusy(true);
    setError(null);
    try {
      const loaded = await loadSheet(picked, { sheetName, allowStage: !!jobPostId });
      setFile(loaded.file);
      setSheet(loaded.sheet);
      setHash(loaded.hash);
      setColumns(loaded.columns);
    } catch (err) {
      setError(sheetErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    if (!file || !sheet || !hash) return;
    setBusy(true);
    setError(null);
    try {
      const rows = applyMapping(sheet.rows, sheet.headers, columns);
      const result = await stageSpreadsheetImportAction({
        fileName: file.name.slice(0, 255),
        ...(jobPostId ? { jobPostId } : {}),
        rows,
        mapping: { headerHash: hash, columns },
      });
      if (result.ok) onComplete({ batchId: result.batchId, rows: result.rows });
      else setError(result.error);
    } catch {
      setError("Couldn't send the rows. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const problem = sheet ? mappingProblem(columns) : null;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-brand/30 bg-brandSoft p-4">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <FileSpreadsheet className="h-4 w-4" />
        Import a spreadsheet
      </div>
      {reason && <p className="text-sm text-muted-foreground">{reason}</p>}

      {!sheet ? (
        <>
          <label htmlFor={inputId} className="sr-only">
            Spreadsheet (CSV or XLSX)
          </label>
          <input
            id={inputId}
            type="file"
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            disabled={busy}
            onChange={(event) => {
              const picked = event.target.files?.[0];
              event.target.value = "";
              if (picked) void read(picked);
            }}
            className="w-full cursor-pointer rounded-lg border border-dashed border-brand/40 bg-background p-3 text-sm text-muted-foreground file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 disabled:cursor-not-allowed"
          />
          <p className="text-xs text-muted-foreground">
            CSV or XLSX, up to 5,000 people and 10 MB. The first row is the header.
          </p>
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <p className="text-sm text-foreground">
              {file?.name}: {plural(sheet.rows.length, "row", "rows")}. Match each column, or ignore it.
            </p>
            {sheet.sheets && (
              <div className="flex flex-col gap-1">
                <Label htmlFor={`${inputId}-sheet`} className="text-xs">
                  Sheet
                </Label>
                <Select value={sheet.sheet} onValueChange={(name) => file && void read(file, name)} disabled={busy}>
                  <SelectTrigger id={`${inputId}-sheet`} aria-label="Sheet" className="h-8 w-40 bg-background">
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
          <div className="max-h-80 overflow-y-auto rounded-xl bg-background">
            <ColumnMapper
              headers={sheet.headers}
              samples={sheet.rows.slice(0, 3)}
              columns={columns}
              onChange={setColumns}
              allowStage={!!jobPostId}
              disabled={busy}
            />
          </div>
          {problem && <p className="text-sm text-destructive">{problem}</p>}
          <p className="text-xs text-muted-foreground">
            The rows are saved for review, so the assistant can check them with you. No one is imported or emailed until
            you approve, and rows you don&apos;t import are deleted after 7 days.
          </p>
        </>
      )}

      {busy && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          {sheet ? "Sending the rows…" : "Reading the file…"}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {sheet && (
          <Button size="sm" variant="brand" disabled={busy || problem !== null} onClick={() => void send()}>
            Send {plural(sheet.rows.length, "row", "rows")} for review
          </Button>
        )}
        {sheet && (
          <Button
            size="sm"
            variant="outline"
            className="bg-background"
            disabled={busy}
            onClick={() => {
              setSheet(null);
              setFile(null);
              setHash(null);
            }}
          >
            Choose another file
          </Button>
        )}
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => onComplete({ cancelled: true })}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
