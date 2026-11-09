import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/utils/types/database.types";
import { reportError } from "@/helpers/posthog/report-error";
import { carryBulletIds } from "@/helpers/resume/carry-bullet-ids";
import { ResumeParseError, parseResumeUpload } from "@/helpers/resume/parse-resume";
import { readResume } from "@/helpers/resume/read-resume";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

// RE-REQ-093/095: a version 1 resume becomes version 2 by re-parsing its stored
// file. It's free, and it's the one writer of `content` besides saveResume.

const RESUME_FILE_BUCKET = "resumes";

export const RESUME_UPGRADE_FAILED_ERROR =
  "We couldn't update this resume to the new format. Upload it again to keep editing.";

export type ResumeToUpgrade = {
  id: string;
  name: string | null;
  content: unknown;
  revision: number;
};

export type UpgradeResult =
  | { ok: true; upgraded: boolean; coverage: number | null }
  | { ok: false; error: string };

/**
 * Re-parses `file` over a version 1 resume, keeping its bullet ids. The write
 * is guarded by `schema_version = 1`, so it can't overwrite a resume already
 * upgraded, and a second run changes nothing. The revision goes up, so anything
 * still holding the old version 1 text gets RESUME_CHANGED and reads again.
 */
export async function upgradeResume(
  admin: SupabaseClient<Database>,
  resume: ResumeToUpgrade,
  file: { bytes: Uint8Array; fileName: string },
): Promise<UpgradeResult> {
  let parsed;
  try {
    parsed = await parseResumeUpload(file.bytes, { fileName: file.fileName });
  } catch (error) {
    if (error instanceof ResumeParseError) return { ok: false, error: error.message };
    throw error;
  }

  const content = carryBulletIds(readResume({ content: resume.content }).content, parsed.content);

  const { data, error } = await admin
    .from("resumes")
    .update({
      content: content as unknown as Json,
      contact: parsed.contact as unknown as Json,
      parse_notes: parsed.parseNotes,
      schema_version: 2,
      revision: resume.revision + 1,
      parsing_failed: false,
      // The default name was the file's, extension and all.
      ...(resume.name && /\.pdf$/i.test(resume.name) ? { name: resume.name.replace(/\.pdf$/i, "") } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", resume.id)
    .eq("schema_version", 1)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`Failed to upgrade the resume: ${error.message}`);

  return { ok: true, upgraded: !!data, coverage: parsed.coverage };
}

/**
 * Upgrades a version 1 resume from its stored file, for a save, a copy or
 * opening the editor (RE-REQ-095). The caller has already checked the resume is
 * the user's; the service role only reads the file and writes the upgrade.
 */
export async function upgradeResumeFromFile(
  resume: ResumeToUpgrade & { resume_path: string | null },
): Promise<UpgradeResult> {
  if (!resume.resume_path) return { ok: false, error: RESUME_UPGRADE_FAILED_ERROR };

  const admin = createServiceRoleClient();
  const { data: blob, error } = await admin.storage.from(RESUME_FILE_BUCKET).download(resume.resume_path);
  if (error || !blob) {
    reportError("[RESUME_UPGRADE_DOWNLOAD_FAILED]:", error?.message ?? "no file");
    return { ok: false, error: RESUME_UPGRADE_FAILED_ERROR };
  }

  const result = await upgradeResume(admin, resume, {
    bytes: new Uint8Array(await blob.arrayBuffer()),
    fileName: resume.resume_path.split("/").pop() ?? "resume.pdf",
  });
  return result.ok ? result : { ok: false, error: RESUME_UPGRADE_FAILED_ERROR };
}
