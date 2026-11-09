import { NextRequest, NextResponse } from "next/server";
import { reportError } from "@/helpers/posthog/report-error";
import { RESUME_REPARSE_QUEUE, userIdFromFilePath } from "@/helpers/resume/migration";
import { RESUME_FILE_BUCKET } from "@/helpers/resume/storage";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendEmailForStatusUpdate } from "@/utils/email";
import { INTERNAL_API_SECRET } from "@/utils/formatters";

const PAGE = 1000;

type Item = { resume_id: string | null; user_id: string; file_path: string };

type Page<T> = PromiseLike<{ data: T[] | null; error: unknown }>;

/**
 * Every row of a read, a page at a time. PostgREST caps a response at
 * `max_rows`, and a resume the read misses looks like an orphan below. It stops
 * on an empty page, not a short one, so a lower cap can't end it early.
 */
async function readAll<T>(page: (from: number, to: number) => Page<T>): Promise<T[]> {
  const rows: T[] = [];
  for (;;) {
    const { data, error } = await page(rows.length, rows.length + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) return rows;
    rows.push(...data);
  }
}

/**
 * RE-REQ-091/092: one resume_migration_items row per resume file, then one
 * queue message per pending row. It lists the bucket as well as the rows,
 * because a version 1 resume deleted before this ran leaves a file with no
 * resume, and that file still has to go.
 *
 * Re-running is safe: `file_path` is unique and `queued_at` sends each file to
 * the queue once. Free: no credits, and no email to the user (RE-REQ-092).
 */
export async function GET(request: NextRequest) {
  if (!INTERNAL_API_SECRET || request.headers.get("X-Internal-Secret") !== INTERNAL_API_SECRET) {
    return NextResponse.json({ message: "Unauthorized access" }, { status: 401 });
  }

  const admin = createServiceRoleClient();

  try {
    // The bucket first: a file that lands after this isn't listed, so one
    // uploaded during the run can't pass for an orphan.
    const bucket = admin.storage.from(RESUME_FILE_BUCKET);
    const listAll = async (path: string) => {
      const entries: { name: string; id: string | null }[] = [];
      for (;;) {
        const { data, error } = await bucket.list(path, { limit: PAGE, offset: entries.length });
        if (error) reportError("[RESUME_REPARSE_ENQUEUE_LIST_FAILED]:", error.message);
        if (error || !data || data.length === 0) return entries;
        entries.push(...data);
      }
    };

    const bucketPaths: string[] = [];
    for (const folder of await listAll("resumes")) {
      if (folder.id) continue; // a file directly under resumes/, which isn't a path we write
      for (const file of await listAll(`resumes/${folder.name}`)) {
        if (file.id) bucketPaths.push(`resumes/${folder.name}/${file.name}`);
      }
    }

    // `resume_path` is `resumes/<user_id>/<timestamp>-<name>`, the key inside the bucket.
    const resumes = await readAll((from, to) =>
      admin
        .from("resumes")
        .select("id, user_id, resume_path")
        .not("resume_path", "is", null)
        .order("id")
        .range(from, to),
    );

    const existing = await readAll((from, to) =>
      admin.from("resume_migration_items").select("file_path").order("file_path").range(from, to),
    );
    const known = new Set(existing.map((row) => row.file_path));

    const byPath = new Map<string, Item>();
    for (const resume of resumes) {
      const path = resume.resume_path;
      if (!path || !resume.user_id) continue;
      byPath.set(path, { resume_id: resume.id, user_id: resume.user_id, file_path: path });
    }

    // Files no row points at: an orphan still has its owner in its path, and one
    // that doesn't is left alone rather than guessed at.
    for (const path of bucketPaths) {
      if (byPath.has(path)) continue;
      const owner = userIdFromFilePath(path);
      if (owner) byPath.set(path, { resume_id: null, user_id: owner, file_path: path });
    }

    const fresh = [...byPath.values()].filter((item) => !known.has(item.file_path));
    if (fresh.length > 0) {
      const { error: insertError } = await admin
        .from("resume_migration_items")
        .upsert(fresh, { onConflict: "file_path", ignoreDuplicates: true });
      if (insertError) throw insertError;
    }

    // All of it before sending: sending sets queued_at, which would shift the pages.
    const pending = await readAll((from, to) =>
      admin
        .from("resume_migration_items")
        .select("id, file_path")
        .eq("status", "pending")
        .is("queued_at", null)
        .order("id")
        .range(from, to),
    );

    let queued = 0;
    for (const item of pending) {
      const { error: sendError } = await admin.schema("pgmq_public").rpc("send", {
        queue_name: RESUME_REPARSE_QUEUE,
        message: { item_id: item.id },
        sleep_seconds: 0,
      });
      if (sendError) {
        reportError("[RESUME_REPARSE_ENQUEUE_SEND_FAILED]:", item.file_path, sendError.message);
        continue;
      }
      await admin
        .from("resume_migration_items")
        .update({ queued_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", item.id);
      queued++;
    }

    await sendEmailForStatusUpdate(
      `RESUME REPARSE ENQUEUE: ${fresh.length} new item(s), ${queued} queued, ${byPath.size} file(s) listed.`,
    );

    return NextResponse.json({ success: true, created: fresh.length, queued, listed: byPath.size });
  } catch (error) {
    reportError("[resume reparse enqueue] critical failure", error);
    return NextResponse.json({ success: false, message: "Internal Server Error" }, { status: 500 });
  }
}
