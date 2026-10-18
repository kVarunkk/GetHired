import "server-only";
import { knockoutReasons } from "@/components/applications/KnockoutBadge";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MyCompany } from "@/helpers/companies/get-my-company";
import type { Database } from "@/utils/types/database.types";
import type { BoardApplication, PipelineBoardData } from "@/utils/types/pipeline.types";
import { ratingSummary, type CandidateRating } from "./ratings";
import { listStages } from "./stages";

/** PL-ASSUMPTION-001: above this many applications, columns are cut... */
export const BOARD_TRUNCATE_ABOVE = 500;
/** ...to this many of their newest cards. */
export const BOARD_STAGE_LIMIT = 200;
/** PostgREST's row cap on the project; the board never asks for more. */
const BOARD_MAX_ROWS = 1000;

const DAY_MS = 86_400_000;

// Only what a card shows. No contact details (PL-SEC-002).
const CARD_COLUMNS =
  "id, stage_id, stage_entered_at, created_at, user_info(full_name), application_screenings(status, fit_score), application_knockouts(failed, reasons)";

type Ctx = { supabase: SupabaseClient<Database>; company: MyCompany };

export type BoardResult = { ok: true; data: PipelineBoardData } | { ok: false; reason: "not_found" };

/**
 * The pipeline board for one of the session company's jobs (PL-TASK-011),
 * shared by the job page's first render and the board's GET route. Cards are
 * newest first. Throws on a database error.
 */
export async function loadBoard(
  { supabase, company }: Ctx,
  jobPostId: string,
  now: Date = new Date(),
): Promise<BoardResult> {
  const { data: job, error: jobError } = await supabase
    .from("job_postings")
    .select("id")
    .eq("id", jobPostId)
    .eq("company_id", company.id)
    .maybeSingle();
  if (jobError) throw new Error(`Failed to load the job: ${jobError.message}`);
  if (!job) return { ok: false, reason: "not_found" };

  const stages = await listStages({ supabase, company });

  const { data: rows, error } = await supabase
    .from("applications")
    .select(CARD_COLUMNS)
    .eq("job_post_id", jobPostId)
    .order("created_at", { ascending: false })
    .limit(BOARD_MAX_ROWS);
  if (error) throw new Error(`Failed to load the applications: ${error.message}`);

  // Counts and ratings only, never the bodies. Joined by job, not by an
  // `in (ids)` list that could outgrow the URL.
  const { data: notes, error: notesError } = await supabase
    .from("candidate_notes")
    .select("application_id, rating, applications!inner(job_post_id)")
    .eq("company_id", company.id)
    .eq("applications.job_post_id", jobPostId);
  if (notesError) throw new Error(`Failed to load the notes: ${notesError.message}`);

  const noteStats = new Map<string, { count: number; rated: { rating: CandidateRating }[] }>();
  for (const note of notes ?? []) {
    if (!note.application_id) continue;
    const stats = noteStats.get(note.application_id) ?? { count: 0, rated: [] };
    stats.count += 1;
    if (note.rating) stats.rated.push({ rating: note.rating });
    noteStats.set(note.application_id, stats);
  }

  const all: BoardApplication[] = (rows ?? []).map((row) => {
    const screening = row.application_screenings;
    const stats = noteStats.get(row.id);
    return {
      id: row.id,
      stageId: row.stage_id,
      name: row.user_info?.full_name?.trim() || "Applicant",
      fitScore: screening?.status === "completed" ? screening.fit_score : null,
      daysInStage: Math.max(
        0,
        Math.floor((now.getTime() - new Date(row.stage_entered_at).getTime()) / DAY_MS),
      ),
      noteCount: stats?.count ?? 0,
      ratingAvg: stats ? ratingSummary(stats.rated).average : null,
      knockoutReasons: row.application_knockouts?.failed ? knockoutReasons(row.application_knockouts) : null,
    };
  });

  const data: PipelineBoardData = {
    stages: stages.map(({ id, name, kind }) => ({ id, name, kind })),
    applications: all,
  };
  if (all.length <= BOARD_TRUNCATE_ABOVE) return { ok: true, data };

  const byStage = new Map<string | null, number>();
  for (const app of all) byStage.set(app.stageId, (byStage.get(app.stageId) ?? 0) + 1);

  const shown = new Map<string | null, number>();
  data.applications = all.filter((app) => {
    const n = (shown.get(app.stageId) ?? 0) + 1;
    shown.set(app.stageId, n);
    return n <= BOARD_STAGE_LIMIT;
  });

  const truncated: Record<string, number> = {};
  for (const [stageId, total] of byStage) {
    if (stageId && total > BOARD_STAGE_LIMIT) truncated[stageId] = total;
  }
  if (Object.keys(truncated).length > 0) data.truncated = truncated;
  return { ok: true, data };
}
