import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// IV-REQ-032a: authenticated can't select `candidate_notes.rating`, and
// ratings are read only through the masking RPCs (`list_candidate_notes`,
// `list_job_note_ratings`), so blind review holds. A direct select of
// `rating` or `*` would fail at runtime; this catches it before then.

const ROOT = process.cwd();
const DIRS = ["app", "helpers", "components", "lib", "utils", "hooks"];

function sourceFiles(dir: string): string[] {
  const full = path.join(ROOT, dir);
  let entries: string[];
  try {
    entries = readdirSync(full);
  } catch {
    return [];
  }
  return entries.flatMap((name) => {
    const rel = path.join(dir, name);
    if (statSync(path.join(ROOT, rel)).isDirectory()) return sourceFiles(rel);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [rel] : [];
  });
}

const selectsRating = (columns: string) => /\*|\brating\b/.test(columns);

/** Problems in one file's source: direct selects of rating, and embedded joins that would read it. */
function ratingReads(source: string): string[] {
  const problems: string[] = [];
  for (const match of source.matchAll(/\.from\(\s*["']candidate_notes["']\s*\)/g)) {
    // The query chain, up to the end of the statement.
    const rest = source.slice(match.index);
    const chain = rest.slice(0, rest.search(/;|\n\s*\n/) + 1 || undefined);
    for (const select of chain.matchAll(/\.select\(\s*(["'`])([\s\S]*?)\1/g)) {
      if (selectsRating(select[2])) problems.push(`select(${select[2]})`);
    }
    // `.select()` with no columns returns every column.
    if (/\.select\(\s*\)/.test(chain)) problems.push("select()");
  }
  for (const join of source.matchAll(/candidate_notes(?:!\w+)?\s*\(([^)]*)\)/g)) {
    if (selectsRating(join[1])) problems.push(`candidate_notes(${join[1]})`);
  }
  return problems;
}

describe("candidate_notes.rating is only read through the masking RPCs (IVT-015)", () => {
  it("finds a direct select of rating or *", () => {
    expect(ratingReads(`db.from("candidate_notes").select("id, rating").eq("id", x);`)).toHaveLength(1);
    expect(ratingReads(`db.from("candidate_notes").select("*");`)).toHaveLength(1);
    expect(ratingReads(`db.from("candidate_notes").insert(row).select();`)).toHaveLength(1);
    expect(ratingReads(`db.from("applications").select("id, candidate_notes(body, rating)");`)).toHaveLength(1);
    expect(ratingReads(`db.from("candidate_notes").update({ rating }).eq("id", x).select("id");`)).toEqual([]);
    expect(ratingReads(`db.rpc("list_candidate_notes", { p_application_id: id });`)).toEqual([]);
  });

  it("has no such read in the app", () => {
    const found = DIRS.flatMap(sourceFiles).flatMap((file) =>
      ratingReads(readFileSync(path.join(ROOT, file), "utf8")).map((p) => `${file}: ${p}`),
    );
    expect(found).toEqual([]);
  });
});
