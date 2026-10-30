// Resume import limits and file checks (BI-REQ-020, BI-REQ-008). Client-safe:
// the dropzone rejects a file before upload with the same rule the actions
// apply. The worker checks the bytes again (extract-text.ts).

export const RESUME_BUCKET = "company-candidate-files";
export const MAX_RESUME_FILES = 100;
export const MAX_RESUME_BYTES = 10 * 1024 * 1024;
/** At most this many resume batches parse at once per company (BI-SEC-008). */
export const MAX_PARSING_BATCHES = 2;

export const RESUME_MIME_TYPES = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
} as const;

export type ResumeExtension = keyof typeof RESUME_MIME_TYPES;

/** For an `<input type="file" accept>`. */
export const RESUME_ACCEPT = ".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export const resumeExtensionOf = (name: string): ResumeExtension | null => {
  const ext = name.trim().toLowerCase().match(/\.([a-z]+)$/)?.[1];
  return ext === "pdf" || ext === "docx" ? ext : null;
};

/**
 * Why a file can't be imported, or null. By extension and declared type: a
 * browser may leave the type empty, which is allowed (the bytes are checked
 * later). Old `.doc` files are refused (BI-DEC-006).
 */
export function resumeFileError(file: { name: string; size: number; type?: string | null }): string | null {
  const ext = resumeExtensionOf(file.name);
  if (!ext) return "Use a PDF or Word (.docx) file.";
  if (file.type && file.type !== RESUME_MIME_TYPES[ext]) return "Use a PDF or Word (.docx) file.";
  if (file.size > MAX_RESUME_BYTES) return "Files can be at most 10 MB.";
  if (file.size === 0) return "This file is empty.";
  return null;
}

/** The import's file reasons, as the grid shows them (BI-REQ-023). */
export const RESUME_ERROR_MESSAGES: Record<string, string> = {
  no_text: "No text found: is it a scan?",
  unreadable: "Couldn't read the file.",
  parse_failed: "Parsing failed.",
};

export const resumeErrorMessage = (code: string | null | undefined) =>
  (code && RESUME_ERROR_MESSAGES[code]) ?? "Parsing failed.";
