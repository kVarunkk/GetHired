import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Database } from "@/utils/types/database.types";
import {
  DIRECTORY_CANDIDATE_COLUMNS,
  RECRUITER_CANDIDATE_COLUMNS,
  directoryCandidateColumnList,
  recruiterCandidateColumnList,
} from "./candidate-columns";
import { FORBIDDEN_CANDIDATE_COLUMNS } from "@/test/utils/recruiter";

type UserInfoColumn = keyof Database["public"]["Tables"]["user_info"]["Row"];

/** Every user_info column; `satisfies` fails to compile if the table gains or loses one. */
const USER_INFO_COLUMNS = {
  accepts_outreach: true,
  ai_credits: true,
  career_goals_long_term: true,
  career_goals_short_term: true,
  company_size_preference: true,
  created_at: true,
  desired_roles: true,
  desired_roles_search: true,
  email: true,
  embedding_new: true,
  embedding_updated_at: true,
  experience_years: true,
  filled: true,
  full_name: true,
  github_url: true,
  industry_preferences: true,
  industry_preferences_search: true,
  invitations_count: true,
  is_job_digest_active: true,
  is_promotion_active: true,
  is_public: true,
  job_type: true,
  last_promo_version_seen: true,
  linkedin_url: true,
  matched_at: true,
  max_salary: true,
  min_salary: true,
  preferred_locations: true,
  referral_code: true,
  relevant_jobs_update_status: true,
  salary_currency: true,
  top_skills: true,
  top_skills_search: true,
  updated_at: true,
  user_id: true,
  visa_sponsorship_required: true,
  work_style_preferences: true,
  work_style_preferences_search: true,
} satisfies Record<UserInfoColumn, true>;

describe("RECRUITER_CANDIDATE_COLUMNS (RS-TEST-006)", () => {
  it("lists the columns of the select string", () => {
    expect(recruiterCandidateColumnList).toEqual(
      RECRUITER_CANDIDATE_COLUMNS.split(",").map((c) => c.trim()),
    );
    expect(new Set(recruiterCandidateColumnList).size).toBe(recruiterCandidateColumnList.length);
  });

  it.each(FORBIDDEN_CANDIDATE_COLUMNS)("doesn't include %s", (column) => {
    expect(recruiterCandidateColumnList).not.toContain(column);
  });

  it("doesn't include any embedding column", () => {
    expect(recruiterCandidateColumnList.filter((c) => /embedding/.test(c))).toEqual([]);
  });

  it("only lists real user_info columns", () => {
    for (const column of recruiterCandidateColumnList) {
      expect(Object.keys(USER_INFO_COLUMNS)).toContain(column);
    }
  });
});

/** Every .ts/.tsx file under `dir`, recursively. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("company code paths", () => {
  it("never select every user_info column", () => {
    const root = process.cwd();
    const files = [
      ...sourceFiles(join(root, "app/company")),
      join(root, "utils/types/jobs.types.ts"),
      join(root, "utils/types/application.types.ts"),
    ];
    const offenders = files.filter((file) =>
      /user_info\s*\(\s*\*\s*\)/.test(readFileSync(file, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});

describe("DIRECTORY_CANDIDATE_COLUMNS (ORT-043)", () => {
  it.each(["email", "linkedin_url", "github_url", "resume_path", ...FORBIDDEN_CANDIDATE_COLUMNS])(
    "doesn't include %s",
    (column) => {
      expect(directoryCandidateColumnList).not.toContain(column);
    },
  );

  it("is a subset of the recruiter columns plus accepts_outreach", () => {
    for (const column of directoryCandidateColumnList) {
      if (column === "accepts_outreach") continue;
      expect(recruiterCandidateColumnList).toContain(column);
    }
  });

  it("lists the columns of the select string, once each", () => {
    expect(directoryCandidateColumnList).toEqual(
      DIRECTORY_CANDIDATE_COLUMNS.split(",").map((c) => c.trim()),
    );
    expect(new Set(directoryCandidateColumnList).size).toBe(directoryCandidateColumnList.length);
  });
});
