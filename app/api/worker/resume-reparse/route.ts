import { NextRequest, NextResponse } from "next/server";
import { reportError } from "@/helpers/posthog/report-error";
import { carryBulletIds } from "@/helpers/resume/carry-bullet-ids";
import {
  RESUME_REPARSE_BATCH_SIZE,
  RESUME_REPARSE_QUEUE,
  RESUME_REPARSE_VISIBILITY_SECONDS,
  isMissingFileError,
  migrationStatusFor,
  shouldRetryMigration,
} from "@/helpers/resume/migration";
import { ResumeParseError, parseResumeUpload } from "@/helpers/resume/parse-resume";
import { readResume } from "@/helpers/resume/read-resume";
import { RESUME_FILE_BUCKET } from "@/helpers/resume/storage";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendEmailForStatusUpdate } from "@/utils/email";
import { INTERNAL_API_SECRET } from "@/utils/formatters";
import type { Json } from "@/utils/types/database.types";

type QueueMessage = { msg_id: number; read_ct: number; message: { item_id: string } };

type Item = {
  id: string;
  resume_id: string | null;
  user_id: string;
  file_path: string;
  status: string;
  attempts: number;
};

/**
 * RE-REQ-092/093/094: the re-parse worker. For each queued resume_migration_items
 * row it downloads the file, parses it, carries the old bullet ids over so the
 * user's reviews keep pointing at the right text, and writes with
 * `where schema_version = 1` so it can never overwrite a resume that was
 * already upgraded (RE-REQ-095).
 *
 * Free: no credits, and no email to the user on success. A provider, storage or
 * database error returns the message for a retry, up to
 * RESUME_REPARSE_MAX_ATTEMPTS; a missing or unreadable file fails the item now.
 * A file whose resume went away still gets a status, so the deletion run can
 * sweep it. `parsed` lets that run delete the file, so an item only gets it once
 * a read has shown there's no version 1 resume left to upgrade.
 */
export async function GET(request: NextRequest) {
  if (!INTERNAL_API_SECRET || request.headers.get("X-Internal-Secret") !== INTERNAL_API_SECRET) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const admin = createServiceRoleClient();
  const queue = admin.schema("pgmq_public");

  const { data, error } = await queue.rpc("read", {
    queue_name: RESUME_REPARSE_QUEUE,
    sleep_seconds: RESUME_REPARSE_VISIBILITY_SECONDS,
    n: RESUME_REPARSE_BATCH_SIZE,
  });
  if (error) {
    reportError("[resume reparse worker] couldn't read the queue", error.message);
    return NextResponse.json({ message: "Couldn't read the queue." }, { status: 500 });
  }

  const messages = (data ?? []) as unknown as QueueMessage[];
  if (messages.length === 0) return NextResponse.json({ parsed: 0, failed: 0, retried: 0, skipped: 0 });

  const counts = { parsed: 0, failed: 0, retried: 0, skipped: 0 };
  const failedPaths: string[] = [];

  const archive = async (msgId: number) => {
    const { error: archiveError } = await queue.rpc("archive", {
      queue_name: RESUME_REPARSE_QUEUE,
      message_id: msgId,
    });
    if (archiveError) reportError(`[resume reparse worker] couldn't archive ${msgId}`, archiveError.message);
  };

  const failed = async (item: Item, error: string) => {
    await admin
      .from("resume_migration_items")
      .update({ status: "failed", error, attempts: item.attempts + 1, updated_at: new Date().toISOString() })
      .eq("id", item.id);
    failedPaths.push(item.file_path);
    counts.failed++;
  };

  /** Leaves the message to come back, until the attempts run out. */
  const retryOrFail = async (item: Item, attempts: number, msgId: number, error: string) => {
    if (shouldRetryMigration(attempts)) {
      await admin
        .from("resume_migration_items")
        .update({ attempts, updated_at: new Date().toISOString() })
        .eq("id", item.id);
      counts.retried++;
      return;
    }
    await failed(item, error);
    await archive(msgId);
  };

  const handle = async ({ msg_id, message }: QueueMessage) => {
    const { data: row } = await admin
      .from("resume_migration_items")
      .select("id, resume_id, user_id, file_path, status, attempts")
      .eq("id", message.item_id)
      .maybeSingle();
    const item = row as Item | null;

    // Gone, or already settled by an earlier delivery: nothing to do twice.
    if (!item || item.status !== "pending" || item.file_path.includes("..")) {
      if (item && item.status !== "pending") counts.skipped++;
      await archive(msg_id);
      return;
    }

    const attempts = item.attempts + 1;

    const { data: blob, error: downloadError } = await admin.storage.from(RESUME_FILE_BUCKET).download(item.file_path);
    if (downloadError && !isMissingFileError(downloadError)) {
      await retryOrFail(item, attempts, msg_id, downloadError.message);
      return;
    }
    if (downloadError || !blob) {
      // A missing file is settled, not retried: there's nothing left to parse.
      await failed(item, downloadError?.message ?? "No file.");
      await archive(msg_id);
      return;
    }

    let parsed;
    try {
      parsed = await parseResumeUpload(new Uint8Array(await blob.arrayBuffer()), {
        fileName: item.file_path.split("/").pop() ?? "resume.pdf",
      });
    } catch (parseError) {
      if (parseError instanceof ResumeParseError) {
        await failed(item, parseError.message);
        await archive(msg_id);
        return;
      }
      // A provider or network problem: leave the message for the retry.
      await retryOrFail(item, attempts, msg_id, parseError instanceof Error ? parseError.message : "Parse failed.");
      return;
    }

    const status = migrationStatusFor(parsed.coverage);

    // An item with no resume_id is only an orphan if no resume points at its
    // file: the deletion run removes it either way, so it's checked here.
    const resumeQuery = admin.from("resumes").select("id, name, content, schema_version, revision");
    const { data: resume, error: resumeError } = await (item.resume_id
      ? resumeQuery.eq("id", item.resume_id)
      : resumeQuery.eq("resume_path", item.file_path).limit(1)
    ).maybeSingle();
    if (resumeError) {
      reportError("[resume reparse worker] couldn't read the resume", resumeError.message);
      await retryOrFail(item, attempts, msg_id, resumeError.message);
      return;
    }

    // Only a version 1 resume is upgraded. One that's already at 2 was re-parsed
    // or upgraded since this item was queued, and its file is all that's left to
    // delete (RE-REQ-093).
    if (resume && resume.schema_version === 1) {
      const content = carryBulletIds(readResume({ content: resume.content }).content, parsed.content);
      const { error: updateError } = await admin
        .from("resumes")
        .update({
          content: content as unknown as Json,
          contact: parsed.contact as unknown as Json,
          parse_notes: parsed.parseNotes,
          schema_version: 2,
          revision: (resume.revision ?? 1) + 1,
          parsing_failed: false,
          ...(resume.name && /\.pdf$/i.test(resume.name) ? { name: resume.name.replace(/\.pdf$/i, "") } : {}),
          updated_at: new Date().toISOString(),
        })
        .eq("id", resume.id)
        .eq("schema_version", 1)
        .select("id")
        .maybeSingle();
      if (updateError) {
        reportError("[resume reparse worker] couldn't write the resume", updateError.message);
        await retryOrFail(item, attempts, msg_id, updateError.message);
        return;
      }
    }

    await admin
      .from("resume_migration_items")
      .update({
        status,
        resume_id: resume?.id ?? item.resume_id,
        coverage: parsed.coverage,
        attempts,
        error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", item.id);
    if (status === "parsed") counts.parsed++;
    else counts.skipped++;
    await archive(msg_id);
  };

  for (const message of messages) {
    try {
      await handle(message);
    } catch (error) {
      // An unexpected error leaves the message unarchived, so it comes back.
      reportError("[resume reparse worker] failed to handle a message", error);
      counts.retried++;
    }
  }

  if (failedPaths.length > 0) {
    await sendEmailForStatusUpdate(`RESUME REPARSE WORKER: ${failedPaths.length} file(s) failed:\n${failedPaths.slice(0, 20).join("\n")}`);
  }

  return NextResponse.json(counts);
}
