import { describe, expect, it } from "vitest";
import type { Destination } from "@/components/candidates/ImportDestination";
import type { MappedRow } from "@/helpers/candidates/map-columns";
import {
  initialSpreadsheetImport,
  spreadsheetImportReducer,
  type ImportResult,
  type LoadedSheet,
  type SpreadsheetImportEvent,
  type SpreadsheetImportState,
} from "./spreadsheet-import-machine";

const blank = { kind: "pool", jobId: null, duplicateAction: "skip" } as unknown as Destination;
const toJob = { kind: "job", jobId: "job-1", duplicateAction: "update" } as unknown as Destination;

const loaded = (name = "people.csv", sheetName = "Sheet1"): LoadedSheet => ({
  file: new File(["name\nAda"], name),
  sheet: { headers: ["name"], rows: [["Ada"]], sheet: sheetName } as unknown as LoadedSheet["sheet"],
  hash: `hash-${sheetName}`,
  columns: ["full_name"],
  savedStageMap: {},
});

const rows = [{ full_name: "Ada", email: "" }] as unknown as MappedRow[];
const noMatches = { existing: [], known: [] };
const result: ImportResult = { counts: { created: 1 } as ImportResult["counts"], jobId: null, list: null };

const upload = initialSpreadsheetImport(blank);
const uploadError: SpreadsheetImportState = { ...upload, error: "Too many rows." } as SpreadsheetImportState;
const map = spreadsheetImportReducer(upload, { type: "loaded", sheet: loaded() });
const review = spreadsheetImportReducer(map, { type: "previewed", rows, matches: noMatches, stageChoices: {} });
const done = spreadsheetImportReducer(review, { type: "confirmed", result });

const busy = (s: SpreadsheetImportState) => ({ ...s, busy: true });
const run = (s: SpreadsheetImportState, ...events: SpreadsheetImportEvent[]) =>
  events.reduce(spreadsheetImportReducer, s);

const events: Record<string, SpreadsheetImportEvent> = {
  busy: { type: "busy" },
  failed: { type: "failed", error: "Nope." },
  loaded: { type: "loaded", sheet: loaded("other.xlsx", "Sheet2") },
  setColumns: { type: "setColumns", columns: ["email"] },
  previewed: { type: "previewed", rows, matches: noMatches, stageChoices: {} },
  back: { type: "back" },
  edit: { type: "edit", index: 0, field: "email", value: "ada@example.com" },
  addMatches: { type: "addMatches", matches: { existing: ["ada@example.com"], known: [] } as never },
  override: { type: "override", index: 0, action: "update" as never },
  setDestination: { type: "setDestination", destination: toJob },
  setStageChoices: { type: "setStageChoices", stageChoices: { Interview: "stage-1" } as never },
  setAttested: { type: "setAttested", attested: true },
  setBasisNote: { type: "setBasisNote", note: "Referral" },
  batchStarted: { type: "batchStarted", batchId: "batch-1" },
  confirmed: { type: "confirmed", result },
  reset: { type: "reset" },
};

// SM-TEST-008: the step every event leads to, from every step.
const steps: Record<string, [SpreadsheetImportState, Record<keyof typeof events, string>]> = {
  upload: [
    upload,
    {
      busy: "upload",
      failed: "upload",
      loaded: "map",
      setColumns: "upload",
      previewed: "upload",
      back: "upload",
      edit: "upload",
      addMatches: "upload",
      override: "upload",
      setDestination: "upload",
      setStageChoices: "upload",
      setAttested: "upload",
      setBasisNote: "upload",
      batchStarted: "upload",
      confirmed: "upload",
      reset: "upload",
    },
  ],
  map: [
    map,
    {
      busy: "map",
      failed: "map",
      loaded: "map",
      setColumns: "map",
      previewed: "review",
      back: "map",
      edit: "map",
      addMatches: "map",
      override: "map",
      setDestination: "map",
      setStageChoices: "map",
      setAttested: "map",
      setBasisNote: "map",
      batchStarted: "map",
      confirmed: "map",
      reset: "upload",
    },
  ],
  review: [
    review,
    {
      busy: "review",
      failed: "review",
      loaded: "review",
      setColumns: "review",
      previewed: "review",
      back: "map",
      edit: "review",
      addMatches: "review",
      override: "review",
      setDestination: "review",
      setStageChoices: "review",
      setAttested: "review",
      setBasisNote: "review",
      batchStarted: "review",
      confirmed: "done",
      reset: "upload",
    },
  ],
  done: [
    done,
    {
      busy: "done",
      failed: "done",
      loaded: "done",
      setColumns: "done",
      previewed: "done",
      back: "done",
      edit: "done",
      addMatches: "done",
      override: "done",
      setDestination: "done",
      setStageChoices: "done",
      setAttested: "done",
      setBasisNote: "done",
      batchStarted: "done",
      confirmed: "done",
      reset: "upload",
    },
  ],
};

// Events that change a step's data without moving it.
const edits: Record<string, (keyof typeof events)[]> = {
  upload: ["busy"],
  map: ["busy", "loaded", "setColumns"],
  review: [
    "busy",
    "edit",
    "addMatches",
    "override",
    "setDestination",
    "setStageChoices",
    "setAttested",
    "setBasisNote",
    "batchStarted",
  ],
  done: [],
};

describe("spreadsheetImportReducer", () => {
  for (const [name, [state, expected]] of Object.entries(steps)) {
    describe(`in ${name}`, () => {
      for (const [eventName, event] of Object.entries(events)) {
        it(`${eventName} → ${expected[eventName]}`, () => {
          const next = spreadsheetImportReducer(state, event);
          expect(next.step).toBe(expected[eventName]);
          // Anything that neither moves nor edits the step is ignored outright.
          if (next.step === state.step && !edits[name].includes(eventName) && eventName !== "reset") {
            expect(next).toBe(state);
          }
        });
      }
    });
  }

  it("covers every event in the table", () => {
    for (const [, expected] of Object.values(steps)) {
      expect(Object.keys(expected).sort()).toEqual(Object.keys(events).sort());
    }
  });

  it("each step carries only its own data", () => {
    expect(Object.keys(upload).sort()).toEqual(["blankDestination", "busy", "error", "step"]);
    expect(Object.keys(map).sort()).toEqual(
      ["blankDestination", "busy", "columns", "error", "file", "hash", "savedStageMap", "settings", "sheet", "step"].sort(),
    );
    expect(Object.keys(review).sort()).toEqual(
      [
        "blankDestination",
        "busy",
        "columns",
        "file",
        "hash",
        "matches",
        "overrides",
        "rows",
        "savedStageMap",
        "settings",
        "sheet",
        "stageChoices",
        "step",
      ].sort(),
    );
    expect(Object.keys(done).sort()).toEqual(["blankDestination", "busy", "result", "step"]);
  });
});

describe("loading a file", () => {
  it("starts a new file with the page's destination and nothing attested", () => {
    expect(map).toMatchObject({
      step: "map",
      file: expect.objectContaining({ name: "people.csv" }),
      settings: { destination: blank, attested: false, basisNote: "", batchId: null },
    });
  });

  it("keeps the decisions for another sheet, but drops the batch", () => {
    const decided = run(review, events.setDestination, events.setAttested, events.batchStarted, events.back);
    const next = spreadsheetImportReducer(decided, events.loaded);
    expect(next).toMatchObject({
      step: "map",
      sheet: { sheet: "Sheet2" },
      settings: { destination: toJob, attested: true, batchId: null },
    });
  });

  it("shows a read error on the upload and the columns steps, and clears it on the next try", () => {
    const failed = run(upload, events.busy, { type: "failed", error: "Too many rows." });
    expect(failed).toMatchObject({ step: "upload", busy: false, error: "Too many rows." });
    expect(spreadsheetImportReducer(failed, events.busy)).toMatchObject({ busy: true, error: null });
    expect(run(map, events.busy, events.failed)).toMatchObject({ step: "map", busy: false, error: "Nope." });
  });

  it("ignores a failure when nothing was running", () => {
    expect(spreadsheetImportReducer(uploadError, events.failed)).toBe(uploadError);
  });
});

describe("reviewing", () => {
  it("resets the duplicate overrides on every preview", () => {
    const overridden = run(review, events.override, events.back, events.previewed);
    expect(overridden).toMatchObject({ step: "review", overrides: {} });
  });

  it("keeps the decisions and the batch going back to the columns", () => {
    const decided = run(review, events.setDestination, events.setAttested, events.setBasisNote, events.batchStarted);
    expect(run(decided, events.back, events.previewed)).toMatchObject({
      settings: { destination: toJob, attested: true, basisNote: "Referral", batchId: "batch-1" },
    });
  });

  it("edits one cell and adds the matches an edited email found", () => {
    const next = run(review, events.edit, events.addMatches);
    expect(next).toMatchObject({
      rows: [{ full_name: "Ada", email: "ada@example.com" }],
      matches: { existing: ["ada@example.com"], known: [] },
    });
  });

  it("keeps a refused confirm on the review, with its batch, and not busy", () => {
    const next = run(review, events.setAttested, events.busy, events.batchStarted, events.failed);
    expect(next).toMatchObject({ step: "review", busy: false, settings: { attested: true, batchId: "batch-1" } });
  });

  it("finishes with the result, and Import more starts over", () => {
    const decided = run(review, events.setDestination, events.busy, events.confirmed);
    expect(decided).toEqual({ step: "done", result, busy: false, blankDestination: blank });
    expect(spreadsheetImportReducer(decided, events.reset)).toEqual(upload);
  });
});

describe("busy", () => {
  it("is set and cleared by the async steps", () => {
    expect(busy(map).busy).toBe(true);
    expect(run(upload, events.busy, events.loaded)).toMatchObject({ step: "map", busy: false });
    expect(run(map, events.busy, events.previewed)).toMatchObject({ step: "review", busy: false });
    expect(run(review, events.busy, events.confirmed)).toMatchObject({ step: "done", busy: false });
  });
});
