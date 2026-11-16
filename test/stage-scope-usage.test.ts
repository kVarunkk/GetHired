import { describe, expect, it } from "vitest";
import { readSource, sourceFiles } from "@/test/utils/source";

// JP-TEST-007 / JPT-020: once a company has several pipelines, a read of
// `pipeline_stages` filtered by `company_id` alone mixes the stages of every
// pipeline. Each such chain filters `pipeline_id` too, or is listed here with
// the reason it's safe (file → reason; the count is how many chains).
const COMPANY_WIDE: Record<string, { count: number; reason: string }> = {
  "helpers/pipeline/stages.ts": {
    count: 3,
    reason:
      "renameStage and archiveStage write one stage by id (the agent and settings pass the pipeline, added to the chain afterwards); archiveStage's final update follows a load that already checked the pipeline",
  },
  "helpers/pipeline/move.ts": {
    count: 1,
    reason:
      "loads the one target stage by id with its pipeline_id, and skips each application whose job is on another pipeline (other_pipeline)",
  },
  "helpers/candidates/preview-agent-add-to-job.ts": {
    count: 1,
    reason: "names one stage by id and refuses it unless its pipeline_id is the job's",
  },
  "helpers/candidates/preview-agent-import.ts": {
    count: 1,
    reason: "names one stage by id and refuses it unless its pipeline_id is the job's",
  },
  "app/company/applications/[application_id]/activity/page.tsx": {
    count: 1,
    reason:
      "names the stages in the application's events, which can be from an earlier pipeline after a switch, so every stage of the company (archived too) is read for names only",
  },
};

/**
 * Each `.from("pipeline_stages")` chain in `source`: the method calls that
 * follow it (`.select(…).eq(…)…`), with balanced parentheses.
 */
function stageChains(source: string): string[] {
  const chains: string[] = [];
  const marker = '.from("pipeline_stages")';
  let at = source.indexOf(marker);
  while (at !== -1) {
    let i = at + marker.length;
    for (;;) {
      const rest = source.slice(i);
      const next = rest.match(/^\s*\.\s*[A-Za-z_]\w*\s*\(/);
      if (!next) break;
      i += next[0].length;
      let depth = 1;
      for (; i < source.length && depth > 0; i++) {
        const ch = source[i];
        if (ch === "(") depth++;
        else if (ch === ")") depth--;
      }
    }
    chains.push(source.slice(at, i));
    at = source.indexOf(marker, i);
  }
  return chains;
}

const companyOnly = (chain: string) => /"company_id"/.test(chain) && !/"pipeline_id"/.test(chain);

function companyWideChains(): Record<string, number> {
  const found: Record<string, number> = {};
  for (const file of sourceFiles(["app", "helpers", "components", "lib"])) {
    const count = stageChains(readSource(file)).filter(companyOnly).length;
    if (count) found[file] = count;
  }
  return found;
}

describe("pipeline_stages reads are scoped to a pipeline (JP-CON-003)", () => {
  it("every chain that filters company_id filters pipeline_id, outside the allowlist", () => {
    const found = companyWideChains();
    const offenders = Object.entries(found).filter(([file, count]) => COMPANY_WIDE[file]?.count !== count);
    expect(Object.fromEntries(offenders)).toEqual({});
  });

  it("the allowlist has no stale entries", () => {
    const found = companyWideChains();
    expect(Object.keys(COMPANY_WIDE).filter((file) => !(file in found))).toEqual([]);
  });

  it("reads a chain across lines up to its last call", () => {
    const source = [
      "const { data } = await supabase",
      '  .from("pipeline_stages")',
      '  .select("id, name")',
      '  .eq("company_id", company.id)',
      '  .order("position", { ascending: true });',
      'const other = supabase.from("pipeline_stages").select("id").eq("pipeline_id", p);',
    ].join("\n");
    const chains = stageChains(source);
    expect(chains).toHaveLength(2);
    expect(chains[0]).toContain('.order("position"');
    expect(chains.map(companyOnly)).toEqual([true, false]);
  });
});
