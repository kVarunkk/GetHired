/**
 * The recruiter catalog's toolsets (RMCP spec §4.5). A company caller can
 * narrow tools/list to some of them on the server URL. No server-only
 * imports, so the /mcp page can build its examples from the same list.
 */

/** Always listed, whatever the URL asks for. */
export const MCP_CORE_TOOLSET = "core";

/** The toolsets a URL can name, in the order the /mcp page shows them. */
export const MCP_TOOLSETS = [
  "jobs",
  "talent",
  "applicants",
  "pipeline",
  "lists",
  "candidates",
  "outreach",
  "interviews",
  "team",
  "careers",
] as const;

export type McpToolset = typeof MCP_CORE_TOOLSET | (typeof MCP_TOOLSETS)[number];

/** Every toolset, core included: what a URL with no `toolsets` gets. */
export const ALL_MCP_TOOLSETS: ReadonlySet<McpToolset> = new Set([MCP_CORE_TOOLSET, ...MCP_TOOLSETS]);

const isToolset = (name: string): name is McpToolset => (ALL_MCP_TOOLSETS as ReadonlySet<string>).has(name);

export type McpToolsetParams =
  | { ok: true; toolsets: ReadonlySet<McpToolset>; readonly: boolean }
  | { ok: false; invalid: string[] };

/**
 * Reads `?toolsets=jobs,pipeline` and `?readonly=true`. No list, an empty
 * one or `all` means every toolset, and `core` is always in. Unknown names
 * come back in `invalid`, since the URL is set once and should fail loudly.
 */
export function parseToolsetParams(url: URL): McpToolsetParams {
  const readonly = url.searchParams.get("readonly")?.trim().toLowerCase() === "true";
  const names = [
    ...new Set(
      (url.searchParams.get("toolsets") ?? "")
        .split(",")
        .map((name) => name.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];

  const invalid = names.filter((name) => name !== "all" && !isToolset(name));
  if (invalid.length > 0) return { ok: false, invalid };
  if (names.length === 0 || names.includes("all")) return { ok: true, toolsets: ALL_MCP_TOOLSETS, readonly };
  return { ok: true, toolsets: new Set([MCP_CORE_TOOLSET, ...names.filter(isToolset)]), readonly };
}

/** The toolsets in use, for instructions and analytics: "all", or the named ones without core. */
export function toolsetsLabel(toolsets: ReadonlySet<McpToolset>): "all" | McpToolset[] {
  if (MCP_TOOLSETS.every((name) => toolsets.has(name))) return "all";
  return MCP_TOOLSETS.filter((name) => toolsets.has(name));
}

/** What each toolset covers, for the /mcp page. */
export const MCP_TOOLSET_LABELS: Record<McpToolset, string> = {
  core: "Always connected: your company and plan",
  jobs: "Job posts and question sets",
  talent: "The talent pool and matches",
  applicants: "Applications, screening and notes",
  pipeline: "Pipeline stages and moves",
  lists: "Talent lists",
  candidates: "Your own candidates and imports",
  outreach: "Messages and email templates",
  interviews: "AI screening interviews",
  team: "Members, roles and invites",
  careers: "The careers page",
};

/** A server URL narrowed to some toolsets and/or read-only, as parseToolsetParams reads it. */
export function mcpToolsetUrl(
  base: string,
  { toolsets, readonly }: { toolsets?: readonly (typeof MCP_TOOLSETS)[number][]; readonly?: boolean },
) {
  const params = [
    toolsets?.length ? `toolsets=${toolsets.join(",")}` : null,
    readonly ? "readonly=true" : null,
  ].filter(Boolean);
  return params.length ? `${base}?${params.join("&")}` : base;
}
