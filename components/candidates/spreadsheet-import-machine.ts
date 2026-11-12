// The spreadsheet import page's flow (SM-REQ-011): upload → map → review →
// done, each step carrying only its own data. Pure, so every event in every
// step is tested in spreadsheet-import-machine.test.ts. The async work (reading
// the file, checking emails, confirming) stays in SpreadsheetImport, which
// dispatches its results here.

import type { Destination } from "@/components/candidates/ImportDestination";
import type { GridField } from "@/components/candidates/ImportPreviewGrid";
import type { ImportCounts } from "@/helpers/candidates/copy";
import type { ColumnMapping, MappedRow } from "@/helpers/candidates/map-columns";
import type { ParsedSheet } from "@/helpers/candidates/parse-sheet";
import type { DuplicateAction, EmailMatches, ExcludedRows } from "@/helpers/candidates/preview-rows";
import type { StageChoices } from "@/helpers/candidates/stage-map";

/** A file that was read, with its columns matched. */
export type LoadedSheet = {
  file: File;
  sheet: ParsedSheet;
  hash: string;
  columns: ColumnMapping;
  savedStageMap: Record<string, string>;
};

/** What the user decided about the import. Kept going back to the columns. */
export type ImportSettings = {
  destination: Destination;
  attested: boolean;
  basisNote: string;
  // Started on the first confirm and reused when a confirm is refused.
  batchId: string | null;
};

export type ReviewData = {
  rows: MappedRow[];
  matches: EmailMatches;
  stageChoices: StageChoices;
  overrides: Record<number, DuplicateAction>;
  /** The rows the user unticked; every other importable row is imported. */
  excluded: ExcludedRows;
};

export type ImportResult = {
  counts: ImportCounts;
  jobId: string | null;
  list: { name: string; slug: string } | null;
};

export type SpreadsheetStep =
  | { step: "upload"; error: string | null }
  | ({ step: "map"; error: string | null; settings: ImportSettings } & LoadedSheet)
  | ({ step: "review"; settings: ImportSettings } & LoadedSheet & ReviewData)
  | { step: "done"; result: ImportResult };

export type SpreadsheetImportState = SpreadsheetStep & {
  busy: boolean;
  // The page's starting destination, for a new file and for Import more.
  blankDestination: Destination;
};

export type SpreadsheetImportEvent =
  | { type: "busy" }
  | { type: "failed"; error?: string }
  | { type: "loaded"; sheet: LoadedSheet }
  | { type: "setColumns"; columns: ColumnMapping }
  | { type: "previewed"; rows: MappedRow[]; matches: EmailMatches; stageChoices: StageChoices }
  | { type: "back" }
  | { type: "edit"; index: number; field: GridField; value: string }
  | { type: "addMatches"; matches: EmailMatches }
  | { type: "override"; index: number; action: DuplicateAction }
  | { type: "select"; indices: number[]; selected: boolean }
  | { type: "setDestination"; destination: Destination }
  | { type: "setStageChoices"; stageChoices: StageChoices }
  | { type: "setAttested"; attested: boolean }
  | { type: "setBasisNote"; note: string }
  | { type: "batchStarted"; batchId: string }
  | { type: "confirmed"; result: ImportResult }
  | { type: "reset" };

export function initialSpreadsheetImport(blankDestination: Destination): SpreadsheetImportState {
  return { step: "upload", error: null, busy: false, blankDestination };
}

const sheetOf = ({ file, sheet, hash, columns, savedStageMap }: LoadedSheet): LoadedSheet => ({
  file,
  sheet,
  hash,
  columns,
  savedStageMap,
});

export function spreadsheetImportReducer(
  state: SpreadsheetImportState,
  event: SpreadsheetImportEvent,
): SpreadsheetImportState {
  const { blankDestination } = state;

  switch (event.type) {
    case "busy":
      if (state.step === "done") return state;
      return state.step === "review" ? { ...state, busy: true } : { ...state, busy: true, error: null };

    case "failed":
      if (!state.busy) return state;
      return state.step === "upload" || state.step === "map"
        ? { ...state, busy: false, error: event.error ?? null }
        : { ...state, busy: false };

    case "loaded":
      // A new file starts over; another sheet of the same workbook keeps the
      // decisions but needs a new batch.
      if (state.step === "upload") {
        return {
          step: "map",
          error: null,
          ...sheetOf(event.sheet),
          settings: { destination: blankDestination, attested: false, basisNote: "", batchId: null },
          busy: false,
          blankDestination,
        };
      }
      if (state.step === "map") {
        return {
          step: "map",
          error: null,
          ...sheetOf(event.sheet),
          settings: { ...state.settings, batchId: null },
          busy: false,
          blankDestination,
        };
      }
      return state;

    case "setColumns":
      return state.step === "map" ? { ...state, columns: event.columns } : state;

    case "previewed":
      if (state.step !== "map") return state;
      return {
        step: "review",
        ...sheetOf(state),
        settings: state.settings,
        rows: event.rows,
        matches: event.matches,
        stageChoices: event.stageChoices,
        overrides: {},
        excluded: {},
        busy: false,
        blankDestination,
      };

    case "back":
      if (state.step !== "review") return state;
      return { step: "map", error: null, ...sheetOf(state), settings: state.settings, busy: false, blankDestination };

    case "confirmed":
      if (state.step !== "review") return state;
      return { step: "done", result: event.result, busy: false, blankDestination };

    case "reset":
      return initialSpreadsheetImport(blankDestination);
  }

  // Everything below edits the review step only.
  if (state.step !== "review") return state;

  switch (event.type) {
    case "edit":
      return {
        ...state,
        rows: state.rows.map((row, i) => (i === event.index ? { ...row, [event.field]: event.value } : row)),
      };

    case "addMatches":
      return {
        ...state,
        matches: {
          existing: [...state.matches.existing, ...event.matches.existing],
          known: [...state.matches.known, ...event.matches.known],
        },
      };

    case "override":
      return { ...state, overrides: { ...state.overrides, [event.index]: event.action } };

    case "select": {
      const excluded: Record<number, true> = { ...state.excluded };
      for (const index of event.indices) {
        if (event.selected) delete excluded[index];
        else excluded[index] = true;
      }
      return { ...state, excluded };
    }

    case "setDestination":
      return { ...state, settings: { ...state.settings, destination: event.destination } };

    case "setStageChoices":
      return { ...state, stageChoices: event.stageChoices };

    case "setAttested":
      return { ...state, settings: { ...state.settings, attested: event.attested } };

    case "setBasisNote":
      return { ...state, settings: { ...state.settings, basisNote: event.note } };

    case "batchStarted":
      return { ...state, settings: { ...state.settings, batchId: event.batchId } };
  }
}
