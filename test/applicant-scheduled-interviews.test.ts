import { describe, expect, it } from "vitest";
import { readSource, sourceFiles } from "@/test/utils/source";

// IV-REQ-043: scheduled_interviews holds the plan snapshot and the panel, so
// applicants never read it. Only the company side and the self-scheduling
// server code (helpers/interviews/*) name the interview tables; applicant
// code goes through my_scheduled_interviews().
const TABLES = /["'`](scheduled_interviews|scheduled_interview_panel|interview_scorecards|interview_feedback_summaries)["'`]/;
const ALLOWED_DIR = "helpers/interviews/";
// The applicant's own helper, which must use the RPC even though it lives there.
const APPLICANT_HELPER = "helpers/interviews/my-scheduled-interviews.ts";

function offenders(): string[] {
  return sourceFiles(["app", "helpers", "components", "lib", "utils", "hooks", "emails"]).filter((file) => {
    if (file === "utils/types/database.types.ts") return false;
    if (file.startsWith(ALLOWED_DIR) && file !== APPLICANT_HELPER) return false;
    return TABLES.test(readSource(file));
  });
}

describe("applicants never read the interview tables (IVT-064)", () => {
  it("only helpers/interviews/* names them, and not the applicant's helper", () => {
    expect(offenders()).toEqual([]);
  });

  it("the applicant's helper and the dashboard use my_scheduled_interviews", () => {
    expect(readSource(APPLICANT_HELPER)).toContain('"my_scheduled_interviews"');
    expect(readSource("app/dashboard/page.tsx")).toContain("listMyScheduledInterviews");
  });

  it("the pattern catches a table read", () => {
    expect(TABLES.test(`supabase.from("scheduled_interviews").select("*")`)).toBe(true);
    expect(TABLES.test(`rpc("my_scheduled_interviews")`)).toBe(false);
  });
});
