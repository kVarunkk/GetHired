export type ResumeExportFormat = "pdf" | "docx";

const DOWNLOAD_FAILED = "We couldn't download this resume. Please try again.";

const fileNameFrom = (header: string | null, format: ResumeExportFormat) =>
  /filename="([^"]+)"/.exec(header ?? "")?.[1] ?? `resume.${format}`;

type DownloadResult = { ok: true } | { ok: false; error: string };

/** Downloads the user's own resume through its export route. */
export const downloadResume = (resumeId: string, format: ResumeExportFormat): Promise<DownloadResult> =>
  downloadResumeFrom(`/api/resumes/${resumeId}/export?format=${format}`, format);

/**
 * Downloads from an export route. It fetches rather than links, so a refusal (a
 * PDF the fonts can't draw, a failed upgrade) reads as a message instead of a
 * page of JSON.
 */
export async function downloadResumeFrom(exportUrl: string, format: ResumeExportFormat): Promise<DownloadResult> {
  try {
    const response = await fetch(exportUrl);
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      return { ok: false, error: body?.error ?? DOWNLOAD_FAILED };
    }

    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = url;
    link.download = fileNameFrom(response.headers.get("content-disposition"), format);
    link.click();
    URL.revokeObjectURL(url);
    return { ok: true };
  } catch {
    return { ok: false, error: DOWNLOAD_FAILED };
  }
}
