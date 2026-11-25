import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readSource, sourceFiles } from "@/test/utils/source";

// AT-REQ-007 / AT-TEST-010: an applicant's private notes on a GetHired
// application are theirs alone. No company code reads them, and only the
// tracker's own code may name the table at all.

const TABLE = "applicant_application_notes";

const COMPANY_DIRS = [
  "app/company",
  "app/api/company",
  "helpers/companies",
  "helpers/agent/roles/recruiter",
  "helpers/candidates",
  "helpers/pipeline",
  "helpers/outreach",
  "components/agent/recruiter",
  "components/candidates",
  "components/pipeline",
];

/** Where the table may be named: the tracker's own code. */
const TRACKER_PREFIXES = ["helpers/tracker/", "app/actions/tracker/", "app/my-jobs/", "components/tracker/", "utils/types/"];

const mentions = (file: string) => readSource(file).includes(TABLE);

describe(`${TABLE} stays private to the applicant`, () => {
  it("no company-side file mentions it", { timeout: 30_000 }, () => {
    const files = [
      ...sourceFiles(COMPANY_DIRS.filter((dir) => existsSync(dir))),
      ...sourceFiles(["helpers/mcp"]).filter((file) => file.startsWith("helpers/mcp/recruiter-")),
      ...sourceFiles(["components"]).filter((file) => /^components\/Company/.test(file)),
    ];
    expect(files.length).toBeGreaterThan(50);
    expect(files.filter(mentions)).toEqual([]);
  });

  it("only the tracker's own code names it", { timeout: 30_000 }, () => {
    const offenders = sourceFiles(["app", "helpers", "components", "lib", "hooks", "utils"])
      .filter((file) => !TRACKER_PREFIXES.some((prefix) => file.startsWith(prefix)))
      .filter(mentions);
    expect(offenders).toEqual([]);
  });
});
