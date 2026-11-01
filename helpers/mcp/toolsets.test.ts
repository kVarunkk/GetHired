/**
 * RMT-050: the toolset parameters on the server URL (RMCP spec §4.5).
 */
import { describe, expect, it } from "vitest";
import {
  MCP_CORE_TOOLSET,
  MCP_TOOLSETS,
  mcpToolsetUrl,
  parseToolsetParams,
  toolsetsLabel,
  type McpToolset,
} from "./toolsets";

const parse = (query: string) => parseToolsetParams(new URL(`https://example.test/api/mcp${query}`));
const every = new Set<McpToolset>([MCP_CORE_TOOLSET, ...MCP_TOOLSETS]);

describe("parseToolsetParams", () => {
  it.each(["", "?toolsets=all", "?toolsets=", "?toolsets=ALL", "?toolsets=jobs,all"])(
    "%s means every toolset",
    (query) => {
      expect(parse(query)).toEqual({ ok: true, toolsets: every, readonly: false });
    },
  );

  it("takes a comma list, tolerating whitespace, case and duplicates", () => {
    expect(parse("?toolsets=%20Jobs%20,pipeline,,jobs,APPLICANTS")).toEqual({
      ok: true,
      toolsets: new Set(["core", "jobs", "pipeline", "applicants"]),
      readonly: false,
    });
  });

  it("always includes core", () => {
    const parsed = parse("?toolsets=team");
    expect(parsed.ok && [...parsed.toolsets].sort()).toEqual(["core", "team"]);
    expect(parse("?toolsets=core")).toEqual({ ok: true, toolsets: new Set(["core"]), readonly: false });
  });

  it.each([
    ["?readonly=true", true],
    ["?readonly=TRUE", true],
    ["?readonly=false", false],
    ["", false],
  ])("%s → readonly %s", (query, readonly) => {
    expect(parse(query)).toMatchObject({ ok: true, readonly });
  });

  it("combines both parameters", () => {
    expect(parse("?toolsets=jobs&readonly=true")).toEqual({
      ok: true,
      toolsets: new Set(["core", "jobs"]),
      readonly: true,
    });
  });

  it("returns unknown names in invalid", () => {
    expect(parse("?toolsets=jobs,payments,Exec,payments")).toEqual({ ok: false, invalid: ["payments", "exec"] });
  });
});

describe("toolsetsLabel", () => {
  it("is all for every toolset, and the named ones otherwise", () => {
    expect(toolsetsLabel(every)).toBe("all");
    expect(toolsetsLabel(new Set<McpToolset>(["core", "pipeline", "jobs"]))).toEqual(["jobs", "pipeline"]);
  });
});

describe("mcpToolsetUrl", () => {
  const BASE = "https://gethired.devhub.co.in/api/mcp";

  it("builds URLs parseToolsetParams reads back", () => {
    expect(mcpToolsetUrl(BASE, { toolsets: ["jobs", "applicants"] })).toBe(`${BASE}?toolsets=jobs,applicants`);
    expect(parseToolsetParams(new URL(mcpToolsetUrl(BASE, { toolsets: ["jobs", "applicants"], readonly: true })))).toEqual({
      ok: true,
      toolsets: new Set(["core", "jobs", "applicants"]),
      readonly: true,
    });
    expect(mcpToolsetUrl(BASE, {})).toBe(BASE);
  });
});
