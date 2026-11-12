import { readdirSync } from "node:fs";
import { join, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { readSource } from "@/test/utils/source";

// Columns dropped by a migration. Nothing in the app, its tests or the
// generated types may name them again (SM-ISS-011).
const DROPPED: Record<string, string> = {
  is_relevant_profiles_generated: "20261110170000_drop_is_relevant_profiles_generated.sql",
};

const SELF = "test/dead-columns.test.ts";

/** Every .ts/.tsx file under `dirs`, tests included, as repo-relative posix paths. */
function allFiles(dirs: string[]): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.(ts|tsx)$/.test(entry.name)) files.push(path.split(sep).join("/"));
    }
  };
  for (const dir of dirs) walk(dir);
  return files;
}

describe("dropped columns", () => {
  it.each(Object.entries(DROPPED))("nothing names %s", (column, migration) => {
    expect(readSource(`supabase/migrations/${migration}`)).toContain(`drop column if exists ${column}`);
    const offenders = allFiles(["app", "components", "helpers", "lib", "utils", "hooks", "emails", "test"]).filter(
      (file) => file !== SELF && readSource(file).includes(column),
    );
    expect(offenders).toEqual([]);
  });
});
