// CSV injection (BI-SEC-004). Imported cells are stored as text as they are;
// a cell that a spreadsheet would run as a formula is only escaped when the
// company exports it again (BI-REQ-061). Client-safe.

/** Whether a spreadsheet would read `cell` as a formula: `=`, `+`, `-` or `@`, after any leading whitespace. */
export function isFormulaLike(cell: string): boolean {
  return /^\s*[=+\-@]/.test(cell);
}

/** One CSV cell: formula-like text gets a `'` prefix, then it's quoted when needed. */
export function escapeCsvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return String(value);
  const safe = isFormulaLike(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
