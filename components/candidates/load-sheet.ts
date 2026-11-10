import { getImportMappingAction } from "@/app/actions/candidates/import-mapping";
import { guessMapping, headerHash, sanitizeMapping } from "@/helpers/candidates/map-columns";
import { parseSheet, SheetError } from "@/helpers/candidates/parse-sheet";
import type { LoadedSheet } from "./spreadsheet-import-machine";

/**
 * Reads a spreadsheet in the browser and matches its columns (BI-REQ-010/011):
 * the mapping saved for these headers, or a guess. A Stage column only means
 * something with a job (BI-REQ-015a), so it's ignored when `allowStage` is off.
 * Shared by the import page and the agent's spreadsheet widget.
 */
export async function loadSheet(
  picked: File,
  { sheetName, allowStage }: { sheetName?: string; allowStage: boolean },
): Promise<LoadedSheet> {
  const sheet = await parseSheet(picked, { sheet: sheetName });
  const hash = await headerHash(sheet.headers);
  const saved = await getImportMappingAction({ headerHash: hash }).catch(() => null);
  const savedMapping = saved?.ok ? saved.mapping : null;
  let columns = savedMapping ? sanitizeMapping(sheet.headers, savedMapping.columns) : guessMapping(sheet.headers);
  if (!allowStage) columns = columns.map((t) => (t === "stage" ? "ignore" : t));
  return { file: picked, sheet, hash, columns, savedStageMap: savedMapping?.stageMap ?? {} };
}

/** What the user sees when a file can't be read. */
export const sheetErrorMessage = (err: unknown) =>
  err instanceof SheetError ? err.message : "Couldn't read this file. Try again.";
