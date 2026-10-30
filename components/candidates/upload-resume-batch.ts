import { createResumeUploadUrlsAction } from "@/app/actions/candidates/create-resume-upload-urls";
import { submitResumeBatchAction } from "@/app/actions/candidates/submit-resume-batch";
import type { EntitlementActionError } from "@/helpers/billing/errors";
import { RESUME_BUCKET } from "@/helpers/candidates/resume-files";
import { createClient } from "@/lib/supabase/client";

const UPLOAD_CONCURRENCY = 4;

/** An action's failure message (an entitlement error carries its own), or null when it worked. */
export const failureOf = (result: { ok: true } | { ok: false; error: string } | EntitlementActionError) =>
  "ok" in result ? (result.ok ? null : result.error) : result.error.message;

export type ResumeBatchUpload = { ok: true; batchId: string } | { ok: false; error: string };

/**
 * BI-REQ-020/021 in the browser: opens a resume batch (for `jobPostId`, or
 * the talent pool), sends each file straight to Storage with its signed URL,
 * then submits the batch for reading, which holds one resume import per
 * file. A file that doesn't arrive fails as unreadable when the batch is
 * submitted. Shared by the import page and the recruiter agent's widget.
 */
export async function uploadResumeBatch(
  files: File[],
  { jobPostId, onProgress }: { jobPostId?: string | null; onProgress?: (message: string) => void } = {},
): Promise<ResumeBatchUpload> {
  const signed = await createResumeUploadUrlsAction({
    ...(jobPostId ? { jobPostId } : {}),
    files: files.map((f) => ({ name: f.name.slice(0, 255), size: f.size, type: f.type || undefined })),
  });
  if (!signed.ok) return signed;

  const storage = createClient().storage.from(RESUME_BUCKET);
  let done = 0;
  onProgress?.(`Uploading 0 of ${files.length}`);
  const queue = signed.uploads.map((u, i) => ({ ...u, file: files[i] }));
  const next = async (): Promise<void> => {
    const item = queue.shift();
    if (!item) return;
    await storage.uploadToSignedUrl(item.path, item.token, item.file).catch(() => null);
    done += 1;
    onProgress?.(`Uploading ${done} of ${files.length}`);
    return next();
  };
  await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, queue.length) }, next));

  onProgress?.("Starting to read them…");
  const submitted = await submitResumeBatchAction({ batchId: signed.batchId });
  const failure = failureOf(submitted);
  if (failure) return { ok: false, error: failure };
  return { ok: true, batchId: signed.batchId };
}
