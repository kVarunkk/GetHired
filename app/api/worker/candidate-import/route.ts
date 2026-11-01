import { reportError } from "@/helpers/posthog/report-error";
import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { consumeEntitlement } from "@/helpers/billing/entitlements";
import { extractResumeText, UnreadableFileError } from "@/helpers/resume/extract-text";
import { parseCandidateResume } from "@/helpers/candidates/parse-candidate-resume";
import { RESUME_BUCKET } from "@/helpers/candidates/resume-files";
import {
  CANDIDATE_IMPORT_MAX_READS,
  CANDIDATE_IMPORT_QUEUE,
  importRowRef,
  releaseRowHolds,
  type CandidateImportMessage,
} from "@/helpers/candidates/resume-import";
import { canonicalizeLocations } from "@/helpers/locations/aliases";
import { sendEmailForStatusUpdate } from "@/utils/email";
import { INTERNAL_API_SECRET } from "@/utils/formatters";
import type { Json } from "@/utils/types/database.types";

type QueueMessage = { msg_id: number; read_ct: number; message: CandidateImportMessage };

/** Long enough to download, read and parse a resume; a failed one comes back after it. */
const VISIBILITY_TIMEOUT = 120;
const BATCH_SIZE = 5;

type FailCode = "no_text" | "unreadable" | "parse_failed";

/**
 * Parses queued resume files (BI-REQ-022), every minute, 5 at a time. Per
 * file: download (service role), extract the text by its bytes, one Gemini
 * call, validate, flag duplicates, then store it as `parsed` (consuming the
 * file's resume_imports hold) or `failed` with a reason (releasing it). A
 * provider or network error leaves the message for a retry, up to
 * CANDIDATE_IMPORT_MAX_READS. A row that's no longer queued (parsed,
 * removed, confirmed) is skipped, so a redelivered message never parses
 * twice. A batch is `ready` once none of its files are in flight.
 */
export async function GET(request: NextRequest) {
  if (!INTERNAL_API_SECRET || request.headers.get("X-Internal-Secret") !== INTERNAL_API_SECRET) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const admin = createServiceRoleClient();
  const queue = admin.schema("pgmq_public");

  const { data, error } = await queue.rpc("read", {
    queue_name: CANDIDATE_IMPORT_QUEUE,
    sleep_seconds: VISIBILITY_TIMEOUT,
    n: BATCH_SIZE,
  });
  if (error) {
    reportError("[candidate import worker] couldn't read the queue", error.message);
    return NextResponse.json({ message: "Couldn't read the queue." }, { status: 500 });
  }
  const messages = (data ?? []) as QueueMessage[];
  if (messages.length === 0) return NextResponse.json({ parsed: 0, failed: 0, retried: 0, skipped: 0 });

  const archive = async (msgId: number) => {
    const { error: archiveError } = await queue.rpc("archive", {
      queue_name: CANDIDATE_IMPORT_QUEUE,
      message_id: msgId,
    });
    if (archiveError) reportError(`[candidate import worker] couldn't archive ${msgId}`, archiveError.message);
  };

  const counts = { parsed: 0, failed: 0, retried: 0, skipped: 0 };
  const gaveUp: string[] = [];
  const batches = new Set<string>();

  const handle = async ({ msg_id, read_ct, message }: QueueMessage) => {
    const { data: row } = await admin
      .from("candidate_import_rows")
      .select("id, batch_id, company_id, file_path, status")
      .eq("id", message.row_id)
      .maybeSingle();
    // A staged spreadsheet row has no file and is never queued.
    if (!row || !row.file_path || (row.status !== "queued" && row.status !== "parsing")) {
      // Gone, removed meanwhile, or already done: nothing to parse twice.
      if (row?.status === "removed") await releaseRowHolds(row.company_id, [row.id]);
      counts.skipped++;
      await archive(msg_id);
      return;
    }
    batches.add(row.batch_id);
    const filePath = row.file_path;

    const setRow = async (values: Record<string, unknown>) => {
      const { error: updateError } = await admin
        .from("candidate_import_rows")
        .update({ ...values, updated_at: new Date().toISOString() })
        .eq("id", row.id)
        .in("status", ["queued", "parsing"]);
      if (updateError) throw new Error(`Couldn't update the row: ${updateError.message}`);
    };

    const fail = async (code: FailCode) => {
      await setRow({ status: "failed", error_code: code });
      await releaseRowHolds(row.company_id, [row.id]);
      counts.failed++;
      await archive(msg_id);
    };

    await setRow({ status: "parsing", attempts: read_ct });

    try {
      const { data: file, error: downloadError } = await admin.storage.from(RESUME_BUCKET).download(filePath);
      if (downloadError || !file) throw new Error(`Couldn't download the file: ${downloadError?.message ?? "no data"}`);

      let lines: string[];
      try {
        ({ lines } = await extractResumeText(new Uint8Array(await file.arrayBuffer())));
      } catch (err) {
        if (err instanceof UnreadableFileError) return await fail("unreadable");
        throw err;
      }

      const parsed = await parseCandidateResume(lines);
      if (!parsed.ok) return await fail(parsed.reason);

      const fields: Record<string, unknown> = { ...parsed.fields };
      if (typeof fields.location === "string") [fields.location] = await canonicalizeLocations([fields.location]);
      const warnings = [...parsed.warnings];

      // BI-REQ-022 (5): an existing candidate or another file in the batch
      // with the same email. Known GetHired users need a session: the grid
      // checks those.
      let duplicateOf: string | null = null;
      const email = typeof fields.email === "string" ? fields.email : null;
      if (email) {
        const { data: existing } = await admin
          .from("company_candidates")
          .select("id")
          .eq("company_id", row.company_id)
          .eq("email", email)
          .maybeSingle();
        duplicateOf = existing?.id ?? null;
        const { count: sameInBatch } = await admin
          .from("candidate_import_rows")
          .select("id", { count: "exact", head: true })
          .eq("batch_id", row.batch_id)
          .neq("id", row.id)
          .eq("status", "parsed")
          .eq("extracted->fields->>email", email);
        if ((sameInBatch ?? 0) > 0) {
          warnings.push({ field: "email", message: "Another file in this import has this email.", value: email });
        }
      }

      await setRow({
        status: "parsed",
        error_code: null,
        extracted: { fields, resume: parsed.resume } as unknown as Json,
        warnings: warnings as unknown as Json,
        duplicate_of: duplicateOf,
      });
      try {
        // The hold's member is charged (RP-REQ-043): the worker passes no actor.
        await consumeEntitlement(row.company_id, "resume_imports", 1, importRowRef(row.id), null);
      } catch (err) {
        reportError("[candidate import worker] couldn't consume a hold", row.id, err);
      }
      counts.parsed++;
      await archive(msg_id);
    } catch (err) {
      // A provider, network or Storage error: tried again until the limit.
      reportError("[candidate import worker] parse failed", row.id, err);
      if (read_ct >= CANDIDATE_IMPORT_MAX_READS) {
        gaveUp.push(`row ${row.id}: ${err instanceof Error ? err.message : String(err)}`);
        await fail("parse_failed");
        return;
      }
      await setRow({ status: "queued" }).catch(() => {});
      counts.retried++;
    }
  };

  // One at a time: each file is a model call and a PDF in memory.
  for (const message of messages) {
    try {
      await handle(message);
    } catch (err) {
      reportError("[candidate import worker] couldn't handle a message", message.msg_id, err);
    }
  }

  for (const batchId of batches) {
    const { error: settleError } = await admin.rpc("resume_batch_settle", { p_batch_id: batchId });
    if (settleError) reportError("[candidate import worker] couldn't settle a batch", batchId, settleError.message);
  }

  if (gaveUp.length > 0) {
    await sendEmailForStatusUpdate(`[CANDIDATE IMPORT] Gave up on ${gaveUp.length} resume(s):\n${gaveUp.join("\n")}`);
  }

  return NextResponse.json(counts);
}
