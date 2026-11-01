import { CanvasFactory } from "pdf-parse/worker";
import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";

// Text extraction for resumes: PDFs (an applicant's upload, parse-resume.ts,
// and a company's import) and DOCX (a company's import only, BI-DEC-006).

export type ResumeFileType = "pdf" | "docx";

/** The file isn't a PDF or DOCX, or couldn't be read as one. */
export class UnreadableFileError extends Error {
  constructor(message = "Couldn't read the file.") {
    super(message);
    this.name = "UnreadableFileError";
  }
}

const startsWith = (bytes: Uint8Array, prefix: number[]) => prefix.every((b, i) => bytes[i] === b);

/**
 * The file's type from its bytes, never its name (BI-REQ-022): `%PDF-` for a
 * PDF; a ZIP with `word/document.xml` for DOCX. Anything else (text, the old
 * binary .doc, another ZIP) is null.
 */
export function sniffFileType(bytes: Uint8Array): ResumeFileType | null {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "pdf";
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    // ZIP entry names are stored as plain text in the local headers.
    const text = new TextDecoder("latin1").decode(bytes);
    return text.includes("word/document.xml") ? "docx" : null;
  }
  return null;
}

const toLines = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

/**
 * A PDF's non-empty, trimmed lines, from a URL or its bytes. `pageMarkers`
 * keeps pdf-parse's "-- 1 of 2 --" lines, which the applicant parser has
 * always had; an import leaves them out, so a scan reads as no text.
 */
export async function extractPdfLines(
  source: { url: string } | { data: Uint8Array },
  { pageMarkers = true }: { pageMarkers?: boolean } = {},
): Promise<string[]> {
  // pdf.js takes ownership of the buffer it's given, so it gets a copy.
  const parser = new PDFParse(
    "url" in source ? { url: source.url, CanvasFactory } : { data: source.data.slice(), CanvasFactory },
  );
  try {
    const result = await parser.getText(pageMarkers ? undefined : { pageJoiner: "" });
    return toLines(result.text);
  } catch {
    throw new UnreadableFileError("Some error occured while extracting text from pdf.");
  } finally {
    await parser.destroy();
  }
}

async function extractDocxLines(bytes: Uint8Array): Promise<string[]> {
  try {
    const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    return toLines(value);
  } catch {
    throw new UnreadableFileError();
  }
}

/**
 * A resume file's lines. Throws UnreadableFileError for a file that isn't a
 * PDF or DOCX or can't be read. A PDF with no text (a scan) gives no lines;
 * the caller decides what that means.
 */
export async function extractResumeText(bytes: Uint8Array): Promise<{ type: ResumeFileType; lines: string[] }> {
  const type = sniffFileType(bytes);
  if (type === "pdf") return { type, lines: await extractPdfLines({ data: bytes }, { pageMarkers: false }) };
  if (type === "docx") return { type, lines: await extractDocxLines(bytes) };
  throw new UnreadableFileError();
}
