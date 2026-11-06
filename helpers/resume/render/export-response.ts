import { NextResponse } from "next/server";
import type { ResumeDocument } from "./document";
import { renderResumeDocx } from "./docx";
import { renderResumePdf } from "./pdf";

const FORMATS = {
  pdf: { contentType: "application/pdf", render: renderResumePdf },
  docx: {
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    render: renderResumeDocx,
  },
} as const;

export type ExportFormat = keyof typeof FORMATS;

export const isExportFormat = (value: string | null): value is ExportFormat => value === "pdf" || value === "docx";

/** Keeps the header safe: no quotes, slashes or line breaks reach Content-Disposition. */
function downloadName(name: string | null, format: ExportFormat) {
  const safe = (name ?? "")
    .replace(/[^\w .()-]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[. ]+/, "")
    .trim()
    .slice(0, 100);
  return `${safe || "resume"}.${format}`;
}

/** A resume as a download, for the export routes. Nothing is stored (RE-REQ-050). */
export async function resumeDownload(document: ResumeDocument, name: string | null, format: ExportFormat) {
  const { contentType, render } = FORMATS[format];
  const bytes = await render(document);

  return new NextResponse(bytes as BodyInit, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${downloadName(name, format)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
