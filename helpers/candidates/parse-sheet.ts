// Reads a candidate spreadsheet in the browser (BI-REQ-010, BI-DEC-004): CSV
// through papaparse, XLSX through exceljs. The file is never uploaded; the
// server re-validates every row on confirm. Every cell comes back as text.

import Papa from "papaparse";
import { MAX_SHEET_BYTES, MAX_SHEET_ROWS } from "./import-limits";

export { MAX_SHEET_BYTES, MAX_SHEET_ROWS };

export type ParsedSheet = {
  /** The workbook's sheet names, when it has more than one (the sheet picker). */
  sheets?: string[];
  /** The sheet that was read (XLSX only). */
  sheet?: string;
  /** The first row, trimmed; an empty cell is named "Column N". */
  headers: string[];
  /** The data rows, each as long as `headers`. Blank rows are dropped. */
  rows: string[][];
};

/** A file that can't be imported, with the message to show. */
export class SheetError extends Error {}

const NOT_A_SHEET = "Upload a .csv or .xlsx file.";

type SheetFile = Blob & { name: string };

export async function parseSheet(file: SheetFile, { sheet }: { sheet?: string } = {}): Promise<ParsedSheet> {
  if (file.size > MAX_SHEET_BYTES) throw new SheetError("This file is over 10 MB. Split it into smaller files.");
  const extension = file.name.toLowerCase().split(".").pop();
  const bytes = new Uint8Array(await file.arrayBuffer());

  if (extension === "xlsx") {
    if (!isZip(bytes)) throw new SheetError(NOT_A_SHEET);
    return readXlsx(bytes, sheet);
  }
  if (extension === "csv") {
    if (isZip(bytes) || bytes.subarray(0, 8192).includes(0)) throw new SheetError(NOT_A_SHEET);
    return readCsv(new TextDecoder("utf-8").decode(bytes));
  }
  throw new SheetError(NOT_A_SHEET);
}

const isZip = (bytes: Uint8Array) =>
  bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;

function readCsv(text: string): ParsedSheet {
  const result = Papa.parse<string[]>(text.replace(/^﻿/, ""), {
    delimitersToGuess: [",", ";", "\t"],
    skipEmptyLines: "greedy",
  });
  return toSheet(result.data);
}

async function readXlsx(bytes: Uint8Array, sheetName: string | undefined): Promise<ParsedSheet> {
  // Loaded only for workbooks: it's the larger of the two libraries.
  const { Workbook } = await import("exceljs");
  const workbook = new Workbook();
  try {
    await workbook.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  } catch {
    throw new SheetError("Couldn't read this workbook. Save it again as .xlsx or .csv.");
  }
  const names = workbook.worksheets.map((w) => w.name);
  const worksheet = (sheetName && workbook.getWorksheet(sheetName)) || workbook.worksheets[0];
  if (!worksheet) throw new SheetError("This workbook has no sheets.");

  const cells: string[][] = [];
  worksheet.eachRow({ includeEmpty: false }, (row) => {
    const values: string[] = [];
    for (let c = 1; c <= row.cellCount; c++) values.push(cellText(row.getCell(c).value));
    cells.push(values);
  });
  return { ...(names.length > 1 ? { sheets: names } : {}), sheet: worksheet.name, ...toSheet(cells) };
}

/** An exceljs cell value as the text a person sees, dates as yyyy-mm-dd. */
export function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return "";
    const iso = value.toISOString();
    return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso.slice(0, 19).replace("T", " ");
  }
  if (typeof value !== "object") return String(value);
  const v = value as Record<string, unknown>;
  if (Array.isArray(v.richText)) return v.richText.map((part: { text?: string }) => part.text ?? "").join("");
  if ("result" in v) return cellText(v.result);
  if ("text" in v) return cellText(v.text);
  return "";
}

function toSheet(raw: string[][]): Pick<ParsedSheet, "headers" | "rows"> {
  const rows = raw
    .map((row) => row.map((cell) => String(cell ?? "")))
    .filter((row) => row.some((cell) => cell.trim() !== ""));
  if (rows.length === 0) throw new SheetError("This file is empty.");

  const [header, ...data] = rows;
  if (data.length === 0) throw new SheetError("This file has a header row but no one in it.");
  if (data.length > MAX_SHEET_ROWS) {
    throw new SheetError(
      `This file has ${data.length.toLocaleString("en-US")} rows. Import at most ${MAX_SHEET_ROWS.toLocaleString("en-US")} at a time.`,
    );
  }

  const width = Math.max(...rows.map((row) => row.length));
  const headers = Array.from({ length: width }, (_, i) => header[i]?.trim() || `Column ${i + 1}`);
  return { headers, rows: data.map((row) => Array.from({ length: width }, (_, i) => row[i] ?? "")) };
}
