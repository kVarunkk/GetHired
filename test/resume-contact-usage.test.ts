import { describe, expect, it } from "vitest";
import { readSource, sourceFiles } from "@/test/utils/source";

// RE-REQ-005 / RE-SEC-006: contact details stay out of `content`, so the many
// readers of `content` need no care. That only holds if the few readers of
// `contact` are known: each file here says why it may read them. A resumes
// `select("*")` counts, because it brings `contact` along.
const ALLOWED: Record<string, string> = {
  "app/resume/[resumeId]/page.tsx": "the owner's resume page",
  "app/resume/[resumeId]/edit/page.tsx": "the owner's editor",
  "app/api/resumes/[resume_id]/export/route.ts": "the owner's own download, checked against the session user",
  "helpers/resumes/duplicate-resume.ts": "copies the owner's contact into their new resume",
  "helpers/resume-review/apply-suggestions.ts": "saveResume needs the owner's contact to write it back unchanged",
  "app/resume-review/[reviewId]/page.tsx": "the owner's review page shows their rendered resume",
  "app/api/resume-review/[review_id]/route.ts": "the owner's review page refreshes through this, limited to the session user",
  "utils/types/review.types.ts": "the type of the owner's review page data, which runs no query",
  "helpers/resumes/update-resume.ts": "saveResume needs the owner's contact, which an edit may change",
  "helpers/resumes/get-resume-details.ts": "the owner's agent and MCP tools; its REST route leaves contact out",
  "helpers/applications/submit-application.ts": "writes the applicant's own contact into the snapshot they send",
  "helpers/applications/backfill-snapshots.ts": "writes the applicant's own contact into the snapshot of an application sent before snapshots existed",
  "helpers/applications/resume-snapshot.ts": "the snapshot's own code: builds it and reads it back",
  "helpers/applications/application-resume.ts": "the company's resume view through the snapshot (RE-REQ-005)",
  "app/company/applications/[application_id]/resume/page.tsx": "the company's resume view through the snapshot (RE-REQ-005)",
  "app/api/company/applications/[id]/resume/export/route.ts": "the download of that same view (RE-REQ-063)",
  "app/company/profiles/[profile_id]/page.tsx": "only after company_has_candidate_access, and RLS gates the row (RE-REQ-064)",
};

/** Comments removed, so a mention in one doesn't count. */
const code = (source: string) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");

/** The select(...) that follows each `.from("resumes")`, up to the end of its chain. */
function resumeSelects(source: string): string[] {
  return [...source.matchAll(/\.from\(\s*["']resumes["']\s*\)/g)].flatMap((match) => {
    const rest = source.slice(match.index! + match[0].length);
    const select = /^\s*\.select\(\s*(["'`])([\s\S]*?)\1/.exec(rest);
    return select ? [select[2]] : [];
  });
}

/** The columns of each embedded `resumes(...)` in a select string. */
function embeddedResumes(source: string): string[] {
  return [...source.matchAll(/\bresumes(?:!\w+)?\s*\(([^)]*)\)/g)].map((match) => match[1]);
}

const readsContact = (columns: string) => /(^|[\s,])(contact|\*)([\s,]|$)/.test(columns.trim());

function contactReaders(file: string): boolean {
  const source = code(readSource(file));
  return (
    source.includes("resume_contact_snapshot") ||
    resumeSelects(source).some(readsContact) ||
    embeddedResumes(source).some(readsContact)
  );
}

function offenders() {
  const files = sourceFiles(["app", "components", "helpers", "lib", "utils", "hooks"]).filter(
    (file) => file !== "utils/types/database.types.ts",
  );
  return files.filter(contactReaders);
}

describe("readers of resume contact details", () => {
  it("every file that reads them is on the allowlist", () => {
    expect(offenders().filter((file) => !(file in ALLOWED))).toEqual([]);
  });

  it("the allowlist has no stale entries", () => {
    const found = offenders();
    expect(Object.keys(ALLOWED).filter((file) => !found.includes(file))).toEqual([]);
  });

  it("no select of every applications column, which brings the contact snapshot along", () => {
    const wholeRows = sourceFiles(["app", "components", "helpers", "lib", "utils", "hooks"]).filter((file) =>
      /\.from\(\s*["']applications["']\s*\)\s*\.select\(\s*["'`]\*/.test(code(readSource(file))),
    );

    expect(wholeRows).toEqual([]);
  });

  it("no embed of every applications column, which brings the snapshots along", () => {
    const wholeEmbeds = sourceFiles(["app", "components", "helpers", "lib", "utils", "hooks"]).filter((file) =>
      /\bapplications(?:!\w+)?\s*\(\s*\*/.test(code(readSource(file))),
    );

    expect(wholeEmbeds).toEqual([]);
  });

  it("finds a select of contact, across lines and in a join", () => {
    expect(resumeSelects(`.from("resumes")\n  .select("id, contact, name")`).some(readsContact)).toBe(true);
    expect(resumeSelects(`.from("resumes").select("*")`).some(readsContact)).toBe(true);
    expect(embeddedResumes(`.select("id, resumes(id, contact)")`).some(readsContact)).toBe(true);
    expect(embeddedResumes(`.select("id, resumes!inner(*)")`).some(readsContact)).toBe(true);
  });

  it("skips other columns and comments", () => {
    expect(resumeSelects(`.from("resumes").select("id, content")`).some(readsContact)).toBe(false);
    expect(embeddedResumes(`.select("resumes(id, content)")`).some(readsContact)).toBe(false);
    expect(resumeSelects(code(`// .from("resumes").select("contact")`))).toEqual([]);
  });
});
