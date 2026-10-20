import { describe, expect, it } from "vitest";
import { readSource, sourceFiles } from "@/test/utils/source";

// BW-T06 (plan/browser-writes/feature-browser-writes-spec.md): the browser
// Supabase client only reads. Inserts, updates, deletes, RPCs and storage
// writes go through server actions, which validate input and take the user
// from the session. RLS and the column guards still apply to both.
const WRITES = [
  /\.(insert|upsert|update)\(/,
  // Supabase's delete() takes no argument or an options object;
  // URLSearchParams.delete("key") takes a string.
  /\.delete\(\s*(\)|\{)/,
  /\.rpc\(/,
  /\.storage\b[\s\S]{0,200}?\.(upload|update|remove|move|copy)\(/,
];

function browserWritesIn(source: string): string[] {
  const code = source
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
    .join("\n");
  return WRITES.filter((pattern) => pattern.test(code)).map(String);
}

const usesBrowserClient = (source: string) => /from\s+["']@\/lib\/supabase\/client["']/.test(source);

describe("browser Supabase writes", () => {
  it("no file that uses the browser client writes with it", () => {
    const offenders: Record<string, string[]> = {};
    for (const file of sourceFiles(["app", "components", "helpers", "hooks", "lib", "utils"])) {
      if (file === "lib/supabase/client.ts") continue;
      const source = readSource(file);
      if (!usesBrowserClient(source)) continue;
      const hits = browserWritesIn(source);
      if (hits.length) offenders[file] = hits;
    }
    expect(offenders).toEqual({});
  });

  it("finds writes and skips reads, comments and URLSearchParams", () => {
    expect(browserWritesIn('await supabase.from("bookmarks").insert({ url })')).toHaveLength(1);
    expect(browserWritesIn('supabase.from("t").delete().eq("id", id)')).toHaveLength(1);
    expect(browserWritesIn('supabase.storage.from("images").upload(path, file)')).toHaveLength(1);
    expect(browserWritesIn('supabase.rpc("fn", {})')).toHaveLength(1);
    expect(browserWritesIn('supabase.from("t").select("id").eq("id", id)')).toEqual([]);
    expect(browserWritesIn('supabase.storage.from("resumes").createSignedUrl(path, 60)')).toEqual([]);
    expect(browserWritesIn('params.delete("metadata_updated")')).toEqual([]);
    expect(browserWritesIn('// supabase.from("t").insert({})')).toEqual([]);
  });
});
