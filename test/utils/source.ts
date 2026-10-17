import { readdirSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";

/** Every non-test .ts/.tsx file under `dirs`, as repo-relative posix paths. */
export function sourceFiles(dirs: string[]): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
        files.push(path.split(sep).join("/"));
      }
    }
  };
  for (const dir of dirs) walk(dir);
  return files;
}

export function readSource(path: string): string {
  return readFileSync(path, "utf8");
}

/**
 * The argument text of each call to `name(` in `source` (balanced parens,
 * so nested calls and objects stay inside). Skips the function's own
 * declaration and mentions in comments.
 */
export function callsOf(source: string, name: string): string[] {
  const calls: string[] = [];
  const pattern = new RegExp(`(?<![\\w.])${name}\\(`, "g");
  for (const match of source.matchAll(pattern)) {
    const start = match.index!;
    const lineStart = source.lastIndexOf("\n", start) + 1;
    const before = source.slice(lineStart, start);
    if (/\/\/|\/\*|^\s*\*|function\s+$/.test(before)) continue;

    let depth = 0;
    let i = start + name.length;
    for (; i < source.length; i++) {
      const ch = source[i];
      if (ch === "(" || ch === "{" || ch === "[") depth++;
      else if (ch === ")" || ch === "}" || ch === "]") {
        depth--;
        if (depth === 0) break;
      }
    }
    calls.push(source.slice(start + name.length + 1, i));
  }
  return calls;
}

/** Splits call arguments at top-level commas, trimmed, without a trailing empty one. */
export function topLevelArgs(args: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of args) {
    if (ch === "(" || ch === "{" || ch === "[") depth++;
    else if (ch === ")" || ch === "}" || ch === "]") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}
