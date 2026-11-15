import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AWAITING_CANDIDATE_ALERT_DAYS,
  BLIND_WINDOW_DAYS,
  FEEDBACK_OVERDUE_HOURS,
  FEEDBACK_SUMMARY_MIN,
  KIT_GRACE_DAYS,
  NOTE_EDIT_HOURS,
  NO_SHOW_WINDOW_DAYS,
  PANEL_MAX,
  PLAN_LIMITS,
  REMIND_GAP_HOURS,
} from "./config";
import {
  BUFFER_MINUTES,
  DEFAULT_WORKING_HOURS,
  HORIZON_DAYS,
  MIN_NOTICE_HOURS,
  SLOT_GRID_MINUTES,
} from "@/helpers/calendar/config";

const MIGRATIONS = path.join(process.cwd(), "supabase", "migrations");

/** The interval a SQL window function returns, from the latest migration that defines it. */
function sqlWindow(fn: string): string {
  const sql = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(path.join(MIGRATIONS, f), "utf8"))
    .filter((text) => text.includes(`function public.${fn}()`))
    .at(-1);
  if (!sql) throw new Error(`no migration defines ${fn}`);
  const body = sql.slice(sql.indexOf(`function public.${fn}()`));
  return body.match(/interval '([^']+)'/)![1];
}

describe("interview config (IVT-002)", () => {
  it("keeps the SQL windows in step with the TS constants", () => {
    expect(sqlWindow("scorecard_blind_window")).toBe(`${BLIND_WINDOW_DAYS} days`);
    expect(sqlWindow("interview_kit_grace")).toBe(`${KIT_GRACE_DAYS} days`);
    expect(sqlWindow("interview_no_show_window")).toBe(`${NO_SHOW_WINDOW_DAYS} days`);
    expect(sqlWindow("scorecard_note_edit_window")).toBe(`${NOTE_EDIT_HOURS} hours`);
    expect(sqlWindow("feedback_overdue_after")).toBe(`${FEEDBACK_OVERDUE_HOURS} hours`);
    expect(sqlWindow("awaiting_candidate_alert_after")).toBe(`${AWAITING_CANDIDATE_ALERT_DAYS} days`);
    expect(sqlWindow("interviewer_reminder_gap")).toBe(`${REMIND_GAP_HOURS} hours`);
  });

  it("needs as many scorecards for a summary as save_feedback_summary does (IV-REQ-051)", () => {
    const sql = readFileSync(path.join(MIGRATIONS, "20261114160000_recruiter_interviews_ai.sql"), "utf8");
    expect(sql).toContain(`function public.feedback_summary_min()
returns integer language sql immutable as $$ select ${FEEDBACK_SUMMARY_MIN} $$;`);
  });

  it("matches the limits the plan RPC checks", () => {
    const sql = readFileSync(path.join(MIGRATIONS, "20261114120000_recruiter_interviews_core.sql"), "utf8");
    expect(sql).toContain(`duration_minutes between ${PLAN_LIMITS.durationMin} and ${PLAN_LIMITS.durationMax}`);
    expect(sql).toContain(`between ${PLAN_LIMITS.competenciesMin} and ${PLAN_LIMITS.competenciesMax}`);
    expect(sql).toContain(`jsonb_array_length(p_items) > ${PLAN_LIMITS.items}`);
    expect(sql).toContain(`not between 1 and ${PANEL_MAX}`);
  });

  it("has the spec's slot rules (D17)", () => {
    expect({ MIN_NOTICE_HOURS, HORIZON_DAYS, BUFFER_MINUTES, SLOT_GRID_MINUTES }).toEqual({
      MIN_NOTICE_HOURS: 24,
      HORIZON_DAYS: 14,
      BUFFER_MINUTES: 10,
      SLOT_GRID_MINUTES: 30,
    });
    expect(Object.keys(DEFAULT_WORKING_HOURS)).toEqual(["mon", "tue", "wed", "thu", "fri"]);
    expect(DEFAULT_WORKING_HOURS.mon).toEqual({ start: "10:00", end: "18:00" });
  });
});
