import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { JOB_POST_MOVE_FIXTURE } from "@/test/utils/job-states";
import {
  JOB_POST_MOVES,
  JOB_POST_STATES,
  allowedMoves,
  moveAllowed,
  publicStatusOf,
  statesForFilter,
  type JobPostState,
} from "./job-states";

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase/migrations");

/** The pairs in the latest `job_post_move_allowed` definition. */
function migrationMoves(): string[] {
  const file = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .reverse()
    .find((f) => readFileSync(path.join(MIGRATIONS_DIR, f), "utf8").includes("function public.job_post_move_allowed"));
  if (!file) throw new Error("no migration defines job_post_move_allowed");
  const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
  const body = sql.slice(sql.indexOf("function public.job_post_move_allowed"));
  const list = body.slice(body.indexOf(" in ("), body.indexOf("$$;"));
  return [...list.matchAll(/\('(\w+)', '(\w+)'\)/g)].map(([, from, to]) => `${from}>${to}`).sort();
}

const fixturePairs = JOB_POST_MOVE_FIXTURE.map(([from, to]) => `${from}>${to}`).sort();

describe("the move table (JL-REQ-001)", () => {
  it("JOB_POST_MOVES is the shared fixture", () => {
    const pairs = JOB_POST_STATES.flatMap((from) => JOB_POST_MOVES[from].map((to) => `${from}>${to}`)).sort();
    expect(pairs).toEqual(fixturePairs);
  });

  it("the migration's job_post_move_allowed is the shared fixture", () => {
    expect(migrationMoves()).toEqual(fixturePairs);
  });

  it("moveAllowed refuses every pair outside the table, including staying put", () => {
    for (const from of JOB_POST_STATES) {
      for (const to of JOB_POST_STATES) {
        expect(moveAllowed(from, to)).toBe(fixturePairs.includes(`${from}>${to}`));
      }
    }
  });
});

describe("allowedMoves", () => {
  const publisher = { canPublish: true, canApprove: false, approvalRequired: false };
  const kinds = (state: JobPostState, viewer: Parameters<typeof allowedMoves>[1]) =>
    allowedMoves(state, viewer).map((m) => m.kind);

  it("never offers a move outside the table", () => {
    const viewers = [
      publisher,
      { ...publisher, approvalRequired: true },
      { canPublish: true, canApprove: true, approvalRequired: true, isSubmitter: true },
      { canPublish: false, canApprove: true, approvalRequired: true },
    ];
    for (const state of JOB_POST_STATES) {
      for (const viewer of viewers) {
        for (const m of allowedMoves(state, viewer)) expect(moveAllowed(state, m.to)).toBe(true);
      }
    }
  });

  it("offers nothing without jobs.publish or jobs.approve", () => {
    for (const state of JOB_POST_STATES) {
      expect(allowedMoves(state, { canPublish: false, canApprove: false, approvalRequired: true })).toEqual([]);
    }
  });

  it("publishes a draft, or submits it when approval is on and the viewer can't approve (D6)", () => {
    expect(kinds("draft", publisher)).toEqual(["publish"]);
    expect(kinds("draft", { ...publisher, approvalRequired: true })).toEqual(["submit"]);
    expect(kinds("draft", { ...publisher, approvalRequired: true, canApprove: true })).toEqual(["publish"]);
  });

  it("lets approvers decide a pending job and the submitter withdraw it", () => {
    expect(kinds("pending_approval", { ...publisher, approvalRequired: true })).toEqual([]);
    expect(kinds("pending_approval", { ...publisher, approvalRequired: true, isSubmitter: true })).toEqual(["withdraw"]);
    expect(kinds("pending_approval", { canPublish: false, canApprove: true, approvalRequired: true })).toEqual([
      "approve",
      "request_changes",
    ]);
  });

  it("pauses, closes, fills and reopens with jobs.publish", () => {
    expect(kinds("open", publisher)).toEqual(["pause", "fill", "close"]);
    expect(kinds("paused", publisher)).toEqual(["resume", "fill", "close"]);
    expect(kinds("closed", publisher)).toEqual(["reopen", "fill"]);
    expect(kinds("filled", publisher)).toEqual(["reopen", "close"]);
    // Reopening never needs approval again.
    expect(kinds("closed", { ...publisher, approvalRequired: true })).toContain("reopen");
  });
});

describe("helpers", () => {
  it("publicStatusOf is active only for open", () => {
    expect(JOB_POST_STATES.filter((s) => publicStatusOf(s) === "active")).toEqual(["open"]);
  });

  it("statesForFilter defaults to open and paused", () => {
    expect(statesForFilter(undefined)).toEqual(["open", "paused"]);
    expect(statesForFilter("nonsense")).toEqual(["open", "paused"]);
    expect(statesForFilter("archive")).toEqual(["closed", "filled"]);
    expect(statesForFilter("all")).toEqual(JOB_POST_STATES);
  });
});
