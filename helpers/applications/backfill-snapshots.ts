import { buildResumeSnapshot } from "@/helpers/applications/resume-snapshot";
import type { Database } from "@/utils/types/database.types";
import type { SupabaseClient } from "@supabase/supabase-js";

// RE-REQ-066/097: applications made before snapshots existed have no
// `resume_snapshot`, and the company pages read only that column. This fills
// them from the linked resume, once, after the re-parse has run.
//
// Imported candidates are skipped: their application shows the company's own
// file (RE-REQ-062), and they have no linked resume to snapshot.

const PAGE = 500;

/** The linked resume, whether PostgREST embeds it as an object or a one-row array. */
const linkedResume = (row: Row) => (Array.isArray(row.resumes) ? row.resumes[0] : row.resumes) ?? null;

export type BackfillCounts = { filled: number; skipped: number; failed: number };

type Row = {
  id: string;
  resume_id: string | null;
  resumes:
    | { id?: string; name?: string | null; content?: unknown; contact?: unknown; template?: string | null; schema_version?: number | null }
    | { id?: string; name?: string | null; content?: unknown; contact?: unknown; template?: string | null; schema_version?: number | null }[]
    | null;
};

/**
 * Fills `resume_snapshot` and `resume_contact_snapshot` on applications that
 * have none, in pages, and reports what it did. Running it again only touches
 * rows still null, so it's safe to re-run.
 */
export async function backfillApplicationSnapshots(
  admin: SupabaseClient<Database>,
  { dryRun = false }: { dryRun?: boolean } = {},
): Promise<BackfillCounts> {
  const counts: BackfillCounts = { filled: 0, skipped: 0, failed: 0 };
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("applications")
      .select("id, resume_id, resumes(id, name, content, contact, template, schema_version)")
      .is("resume_snapshot", null)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;

    const rows = (data ?? []) as unknown as Row[];
    if (rows.length === 0) break;

    for (const row of rows) {
      const resume = linkedResume(row);
      // No linked resume is an imported candidate, or one whose resume was deleted.
      if (!row.resume_id || !resume) {
        counts.skipped++;
        continue;
      }

      const snapshot = buildResumeSnapshot(resume);
      // A resume the re-parse hasn't reached yet has no content to snapshot.
      if (!snapshot.resume_snapshot) {
        counts.skipped++;
        continue;
      }
      if (dryRun) {
        counts.filled++;
        continue;
      }

      const { error: updateError } = await admin.from("applications").update(snapshot).eq("id", row.id);
      if (updateError) {
        counts.failed++;
        continue;
      }
      counts.filled++;
    }

    if (rows.length < PAGE) break;
  }

  return counts;
}
