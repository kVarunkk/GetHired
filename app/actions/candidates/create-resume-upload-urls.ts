"use server";

import { z } from "zod";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { importMessage } from "@/helpers/candidates/copy";
import { MAX_RESUME_FILES, RESUME_BUCKET, resumeFileError } from "@/helpers/candidates/resume-files";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

const inputSchema = z
  .object({
    /** Absent: the talent pool, which needs applicants.import unscoped (CP-REQ-004). */
    jobPostId: z.string().uuid().optional(),
    files: z
      .array(
        z
          .object({
            name: z.string().trim().min(1).max(255),
            size: z.number().int().nonnegative(),
            type: z.string().max(200).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(MAX_RESUME_FILES),
  })
  .strict();

export type ResumeUpload = { rowId: string; fileName: string; path: string; token: string };

export type CreateResumeUploadUrlsResult =
  | { ok: true; batchId: string; uploads: ResumeUpload[] }
  | { ok: false; error: string };

type StartedRow = { id: string; file_name: string; file_path: string };

/**
 * SERVER ACTION (BI-REQ-020, CP-REQ-002): opens a draft resume batch, for a
 * job or for the talent pool, and returns one signed upload URL per file, so
 * files go straight from the browser to Storage. Needs applicants.import for
 * the job, or unscoped without one. Paths
 * (<company>/<batch>/<row>.<ext>) come from `start_resume_import`, which
 * also applies BI-SEC-008's limits; nothing in the input names a path.
 */
export async function createResumeUploadUrlsAction(
  input: z.input<typeof inputSchema>,
): Promise<CreateResumeUploadUrlsResult> {
  const parsed = inputSchema.safeParse(input);
  // An unparseable request needs scope `all`, so it's still refused for scoped members.
  const jobId = parsed.success ? (parsed.data.jobPostId ?? null) : null;
  const auth = await requireCompanyForAction({ permission: "applicants.import", jobId });
  if (!auth.ok) return { ok: false, error: auth.error };
  if (!parsed.success) {
    const tooMany = (input?.files?.length ?? 0) > MAX_RESUME_FILES;
    return { ok: false, error: tooMany ? `Import at most ${MAX_RESUME_FILES} resumes at a time.` : importMessage("invalid") };
  }

  for (const file of parsed.data.files) {
    const error = resumeFileError(file);
    if (error) return { ok: false, error: `${file.name}: ${error}` };
  }

  const { data, error } = await auth.supabase.rpc("start_resume_import", {
    // The generated type says string; the function takes null for the pool.
    p_job_id: parsed.data.jobPostId ?? (null as unknown as string),
    p_files: parsed.data.files.map((f) => ({ name: f.name })),
  });
  if (error) throw new Error(`Failed to start the resume import: ${error.message}`);
  const started = data as { ok: boolean; reason?: string; batch_id?: string; rows?: StartedRow[] };
  if (!started.ok || !started.batch_id || !started.rows) return { ok: false, error: importMessage(started.reason) };

  // The batch is the session company's (the RPC checked); only Storage needs the service role.
  const bucket = createServiceRoleClient().storage.from(RESUME_BUCKET);
  const uploads = await Promise.all(
    started.rows.map(async (row) => {
      const { data: signed, error: signError } = await bucket.createSignedUploadUrl(row.file_path);
      if (signError || !signed) throw new Error(`Failed to sign an upload: ${signError?.message ?? "no data"}`);
      return { rowId: row.id, fileName: row.file_name, path: row.file_path, token: signed.token };
    }),
  );
  return { ok: true, batchId: started.batch_id, uploads };
}
