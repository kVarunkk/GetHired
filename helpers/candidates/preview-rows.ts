// The spreadsheet preview (BI-REQ-013/014/018/019): each mapped row's status,
// the counts per status, and for a job destination how many rows will use a
// screening. Client-safe; re-run after every cell edit.

import { parseCandidateFields, type CandidateFieldErrors, type CandidateRow } from "./candidate-schema";
import type { MappedRow } from "./map-columns";
import { hasScreenableDetail } from "./screenable";

export const PREVIEW_STATUSES = ["ready", "error", "duplicate_in_file", "existing", "known"] as const;
export type PreviewStatus = (typeof PREVIEW_STATUSES)[number];

export const PREVIEW_STATUS_LABELS: Record<PreviewStatus, string> = {
  ready: "Ready",
  error: "Needs a fix",
  duplicate_in_file: "Duplicate in file",
  existing: "Already a candidate",
  known: "Already in your pipeline",
};

export const DUPLICATE_ACTIONS = ["skip", "fill", "overwrite"] as const;
export type DuplicateAction = (typeof DUPLICATE_ACTIONS)[number];

export const DUPLICATE_ACTION_LABELS: Record<DuplicateAction, string> = {
  skip: "Skip",
  fill: "Fill empty fields",
  overwrite: "Overwrite",
};

/** From `checkImportEmailsAction`: the company's candidates and the GetHired users the member can see. */
export type EmailMatches = {
  existing: { email: string; id: string }[];
  known: { email: string; userId: string; fullName: string | null }[];
};

export type PreviewRow = {
  /** The row's position in the file's data rows. */
  index: number;
  status: PreviewStatus;
  /** Field → message, for an `error` row. */
  errors: CandidateFieldErrors;
  /** The validated fields; null for an `error` row. */
  data: CandidateRow | null;
  email: string | null;
  /** `existing`: the candidate it matches. */
  existingId: string | null;
  /** `known`: the GetHired user it matches. */
  knownUserId: string | null;
  /** A job destination and no email: imported, but not added to the job (BI-REQ-015). */
  noEmailForJob: boolean;
  /** A job destination: the row gets an application with enough detail to be scored (BI-REQ-018). */
  scored: boolean;
  /** Goes to the confirm: an importable status the user didn't untick. */
  selected: boolean;
};

export type JobPreview = {
  /** Applications that will use a screening. */
  scored: number;
  /** Applications that won't be scored until a resume is added (BI-REQ-036). */
  unscored: number;
  /** Imported as candidates but not added to the job. */
  noEmail: number;
  /** GetHired users: counted as already in the job, or to reach through outreach. */
  known: number;
};

export type Preview = {
  rows: PreviewRow[];
  counts: Record<PreviewStatus, number>;
  /** Rows that will be imported: importable and ticked. */
  selected: number;
  /** Null without a job destination; counts the selected rows only. */
  job: JobPreview | null;
};

/** Rows the user unticked, by index. Untouched rows are selected. */
export type ExcludedRows = Readonly<Record<number, true>>;

/** The statuses that can go to the confirm action. Errors and later duplicates are left out. */
export const IMPORTED_STATUSES: readonly PreviewStatus[] = ["ready", "existing", "known"];

export function previewRows(
  rows: readonly MappedRow[],
  { matches, withJob, excluded = {} }: { matches: EmailMatches; withJob: boolean; excluded?: ExcludedRows },
): Preview {
  const existing = new Map(matches.existing.map((m) => [m.email.toLowerCase(), m.id]));
  const known = new Map(matches.known.map((m) => [m.email.toLowerCase(), m.userId]));
  const seen = new Set<string>();
  const counts = Object.fromEntries(PREVIEW_STATUSES.map((s) => [s, 0])) as Record<PreviewStatus, number>;
  const job: JobPreview = { scored: 0, unscored: 0, noEmail: 0, known: 0 };
  let selected = 0;

  const out = rows.map((row, index): PreviewRow => {
    // The stage column only means something with a job (BI-REQ-015a).
    const { stage, ...fields } = row;
    const parsed = parseCandidateFields(withJob && stage !== undefined ? { ...fields, stage } : fields, { withJob });
    const base = { index, existingId: null, knownUserId: null, noEmailForJob: false, scored: false, selected: false };

    if (!parsed.ok) {
      counts.error++;
      return { ...base, status: "error", errors: parsed.errors, data: null, email: null };
    }
    const data = parsed.data;
    const email = data.email ?? null;
    let status: PreviewStatus = "ready";
    if (email && seen.has(email)) status = "duplicate_in_file";
    else if (email && known.has(email)) status = "known";
    else if (email && existing.has(email)) status = "existing";
    // An unticked row doesn't claim its email: a later repeat is imported instead.
    const isSelected = !excluded[index] && IMPORTED_STATUSES.includes(status);
    if (email && !excluded[index]) seen.add(email);
    counts[status]++;
    if (isSelected) selected++;

    const result: PreviewRow = {
      ...base,
      status,
      errors: {},
      data,
      email,
      existingId: status === "existing" ? existing.get(email!)! : null,
      knownUserId: status === "known" ? known.get(email!)! : null,
      selected: isSelected,
    };
    if (!isSelected) return result;
    if (withJob && (status === "ready" || status === "existing")) {
      if (!email) {
        result.noEmailForJob = true;
        job.noEmail++;
      } else if (hasScreenableDetail(data)) {
        result.scored = true;
        job.scored++;
      } else {
        job.unscored++;
      }
    }
    if (withJob && status === "known") job.known++;
    return result;
  });

  return { rows: out, counts, selected, job: withJob ? job : null };
}

export type SelectionFilter = "selected" | "not_selected";

export type PreviewFilters = {
  status: PreviewStatus | null;
  selection: SelectionFilter | null;
  /** The column the search looks in; null for every shown column. */
  field: string | null;
  query: string;
};

export const NO_PREVIEW_FILTERS: PreviewFilters = { status: null, selection: null, field: null, query: "" };

export const previewFiltersActive = (f: PreviewFilters) =>
  f.status !== null || f.selection !== null || f.field !== null || f.query.trim() !== "";

/**
 * The preview rows the grid shows: by status, by whether they're ticked, and
 * a case-insensitive search of the cells as edited (`rows`), in one column or
 * in every one of `fields`.
 */
export function filterPreviewRows(
  previewed: readonly PreviewRow[],
  rows: readonly MappedRow[],
  fields: readonly (keyof MappedRow)[],
  { status, selection, field, query }: PreviewFilters,
): PreviewRow[] {
  const needle = query.trim().toLowerCase();
  const searched = (field ? fields.filter((f) => f === field) : fields) as (keyof MappedRow)[];
  return previewed.filter((r) => {
    if (status && r.status !== status) return false;
    if (selection === "selected" && !r.selected) return false;
    if (selection === "not_selected" && r.selected) return false;
    if (!needle) return true;
    const row = rows[r.index] ?? {};
    return searched.some((f) => (row[f] ?? "").toLowerCase().includes(needle));
  });
}

/**
 * BI-REQ-018: a warning when the scored rows need more screenings than the
 * company has left (`remaining` null = unlimited). Screening still queues.
 */
export function screeningWarning(scored: number, remaining: number | null): string | null {
  if (remaining === null || scored <= remaining) return null;
  return `You have ${remaining.toLocaleString("en-US")} ${remaining === 1 ? "screening" : "screenings"} left this period and this import needs ${scored.toLocaleString("en-US")}. The rest won't be scored until you add more.`;
}

/** A row as the confirm action takes it: the fields, the stage, and a per-row duplicate action. */
export type ConfirmRow = Record<string, unknown> & { duplicate_action?: DuplicateAction };

/**
 * The rows to confirm: the selected ready rows, already a candidate (with its
 * duplicate action when it differs from the import's) and known users. Blank fields are sent
 * as null, so "overwrite" clears them.
 */
export function rowsToConfirm(
  preview: Preview,
  { overrides = {}, defaultAction }: { overrides?: Record<number, DuplicateAction>; defaultAction: DuplicateAction },
): ConfirmRow[] {
  return preview.rows.flatMap((row) => {
    if (!row.selected || !row.data) return [];
    const fields = Object.fromEntries(Object.entries(row.data).filter(([, v]) => v !== undefined));
    const action = overrides[row.index];
    return [row.status === "existing" && action && action !== defaultAction ? { ...fields, duplicate_action: action } : fields];
  });
}
