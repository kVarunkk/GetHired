import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Next replaces the root layout's `openGraph` / `twitter` as a whole when a
// page sets its own, so a page that sets either without images loses the
// share image. Every metadata file that sets them must pass images.
const ROOTS = ["app", "helpers"];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe("share image", () => {
  const files = ROOTS.flatMap(sourceFiles).filter((file) =>
    /\bopenGraph\s*:|^\s*twitter\s*:/m.test(readFileSync(file, "utf8")),
  );

  it("finds the metadata files", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it.each(files)("%s passes an image with its openGraph/twitter metadata", (file) => {
    const source = readFileSync(file, "utf8");
    expect(source).toMatch(/shareImages|images\s*:/);
  });
});
