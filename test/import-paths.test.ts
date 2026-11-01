import { describe, expect, it } from "vitest";
import { readSource, sourceFiles } from "@/test/utils/source";

// CPT-020 (CP-REQ-032): links to the import pages are built with
// helpers/candidates/paths.ts (jobImportPath, candidateImportPath,
// newCandidatePath), so a route change happens in one place. Tests and the
// helper itself are exempt.
const HAND_BUILT = /["'`][^"'`\n]*(?:\/candidates\/import|\/candidates\/new|job-posts\/[^"'`\n]*\/import)[^"'`\n]*["'`]/;

describe("import paths", () => {
  it("no source file builds an import path by hand", () => {
    const offenders = sourceFiles(["app", "helpers", "components"]).filter(
      (file) =>
        file !== "helpers/candidates/paths.ts" &&
        !/\.test\.tsx?$/.test(file) &&
        readSource(file)
          .split("\n")
          .some((line) => !/^\s*(\/\/|\/\*|\*|import\b)/.test(line) && HAND_BUILT.test(line)),
    );
    expect(offenders).toEqual([]);
  });
});
