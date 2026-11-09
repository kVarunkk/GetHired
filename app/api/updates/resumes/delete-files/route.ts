import { NextRequest, NextResponse } from "next/server";
import { reportError } from "@/helpers/posthog/report-error";
import {
  RESUME_FILE_DELETION_BATCH_SIZE,
  RESUME_FILE_DELETION_GRACE_DAYS,
  resumeFileDeletionEnabled,
} from "@/helpers/resume/migration";
import { sendResumeReuploadEmail } from "@/helpers/resume/send-reupload-email";
import { RESUME_FILE_BUCKET } from "@/helpers/resume/storage";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendEmailForStatusUpdate } from "@/utils/email";
import { INTERNAL_API_SECRET } from "@/utils/formatters";

type Item = {
  id: string;
  resume_id: string | null;
  user_id: string;
  file_path: string;
  status: string;
  notified_at: string | null;
};

const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

/**
 * RE-REQ-098: deletes the old resume files, in batches, once the switch is on.
 *
 * - `parsed` items go straight away: the resume is upgraded and needs no file.
 * - `low_coverage` and `failed` items keep their file until the user has been
 *   told to upload again and RESUME_FILE_DELETION_GRACE_DAYS have passed
 *   (RE-DEC-009). The user is emailed once, and `notified_at` records it.
 * - A file whose resume was deleted is still swept, and its item's
 *   `resume_id` is already null.
 *
 * Off by default: `RESUME_FILE_DELETION_ENABLED` is unset until RET-115, so a
 * deployed route does nothing. Re-running is safe: `file_deleted_at` marks a
 * file as gone and the query only reads rows still null.
 */
export async function GET(request: NextRequest) {
  if (!INTERNAL_API_SECRET || request.headers.get("X-Internal-Secret") !== INTERNAL_API_SECRET) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  if (!resumeFileDeletionEnabled()) {
    return NextResponse.json({ enabled: false, deleted: 0, notified: 0 });
  }

  const admin = createServiceRoleClient();

  try {
    const deleted = { parsed: 0, failed: 0 };
    let notified = 0;

    // The files that need no email: parsed, or older ones with their grace spent.
    const eligible = async (status: "parsed" | "failed" | "low_coverage") => {
      const query = admin
        .from("resume_migration_items")
        .select("id, resume_id, user_id, file_path, status, notified_at")
        .eq("status", status)
        .is("file_deleted_at", null)
        .limit(RESUME_FILE_DELETION_BATCH_SIZE);
      const { data, error } = await (status === "parsed"
        ? query
        : query.not("notified_at", "is", null).lt("notified_at", daysAgo(RESUME_FILE_DELETION_GRACE_DAYS)));
      return { data: (data ?? []) as Item[], error };
    };

    const remove = async (items: Item[], status: "parsed" | "failed" | "low_coverage") => {
      // Only files under the resumes/ prefix, whatever the row says.
      const paths = items.map((item) => item.file_path).filter((path) => path.startsWith("resumes/"));
      if (paths.length === 0) return;
      const { error } = await admin.storage.from(RESUME_FILE_BUCKET).remove(paths);
      if (error) {
        reportError("[RESUME_FILE_DELETION_FAILED]:", status, error.message);
        return;
      }
      const now = new Date().toISOString();
      for (const item of items) {
        if (!item.file_path.startsWith("resumes/")) continue;
        await admin
          .from("resume_migration_items")
          .update({ file_deleted_at: now, updated_at: now })
          .eq("id", item.id);
      }
      deleted[status === "parsed" ? "parsed" : "failed"] += paths.length;
    };

    // 1. Parsed files: nothing else to do with them.
    const parsed = await eligible("parsed");
    if (parsed.error) throw parsed.error;
    await remove(parsed.data, "parsed");

    // 2. Failed and low-coverage files: email once, then delete after the grace period.
    for (const status of ["failed", "low_coverage"] as const) {
      const pendingEmail = admin
        .from("resume_migration_items")
        .select("id, user_id, file_path, status, notified_at, resume_id")
        .eq("status", status)
        .is("file_deleted_at", null)
        .is("notified_at", null)
        .limit(RESUME_FILE_DELETION_BATCH_SIZE);
      const { data: toNotify, error: notifyError } = await pendingEmail;
      if (notifyError) throw notifyError;

      const orphans: Item[] = [];
      for (const item of (toNotify ?? []) as Item[]) {
        // A file whose resume is gone has nobody to ask again: it's already
        // deleted on the user's side, so it goes now with no email.
        const { data: resume } = item.resume_id
          ? await admin.from("resumes").select("id, name").eq("id", item.resume_id).maybeSingle()
          : { data: null };
        if (!resume) {
          orphans.push(item);
          continue;
        }

        const { data: profile } = await admin.from("user_info").select("email").eq("user_id", item.user_id).maybeSingle();
        const sent = await sendResumeReuploadEmail(profile?.email ?? null, resume.name ?? "your resume");
        // Only a sent email starts the 30 days; otherwise the next run tries again.
        if (!sent) continue;
        await admin
          .from("resume_migration_items")
          .update({ notified_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq("id", item.id);
        notified++;
      }
      await remove(orphans, status);

      const ripe = await eligible(status);
      if (ripe.error) throw ripe.error;
      await remove(ripe.data, status);
    }

    const total = deleted.parsed + deleted.failed;
    if (total > 0 || notified > 0) {
      await sendEmailForStatusUpdate(
        `RESUME FILE DELETION: ${deleted.parsed} parsed, ${deleted.failed} failed/low-coverage deleted, ${notified} user(s) emailed.`,
      );
    }

    return NextResponse.json({ enabled: true, deleted: total, notified });
  } catch (error) {
    reportError("[resume file deletion] critical failure", error);
    return NextResponse.json({ success: false, message: "Internal Server Error" }, { status: 500 });
  }
}
