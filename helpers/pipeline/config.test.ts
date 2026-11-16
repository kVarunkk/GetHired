import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  MAX_ACTIVE_STAGES,
  MAX_PIPELINES_PER_COMPANY,
  MAX_STAGE_NAME,
  PIPELINE_NAME_MAX,
} from "./config";

const sql = readFileSync(
  path.join(process.cwd(), "supabase/migrations/20261115130000_job_pipelines.sql"),
  "utf8",
);

// JPT-002: the app's limits are the ones the DB enforces.
describe("pipeline config", () => {
  it("matches the SQL pipeline limit", () => {
    const fn = sql.slice(sql.indexOf("function public.create_pipeline"));
    expect(fn).toMatch(new RegExp(`and not archived\\) >= ${MAX_PIPELINES_PER_COMPANY} then`));
  });

  it("matches the SQL pipeline name length", () => {
    expect(sql).toMatch(new RegExp(`check \\(char_length\\(btrim\\(name\\)\\) between 1 and ${PIPELINE_NAME_MAX}\\)`));
    const fn = sql.slice(sql.indexOf("function public.create_pipeline"));
    expect(fn).toMatch(new RegExp(`char_length\\(v_name\\) not between 1 and ${PIPELINE_NAME_MAX}`));
  });

  it("matches the SQL per-pipeline stage limit", () => {
    const fn = sql.slice(sql.indexOf("function public.pipeline_stages_before_write"));
    expect(fn).toMatch(new RegExp(`\\) >= ${MAX_ACTIVE_STAGES} then`));
    expect(fn).toContain(`at most ${MAX_ACTIVE_STAGES} stages`);
  });

  it("keeps the stage name length", () => {
    expect(MAX_STAGE_NAME).toBe(40);
  });
});
