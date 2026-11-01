/**
 * Pieces shared by the MCP pages: the /mcp setup guide and the two landing
 * pages (/mcp-server for job seekers, /mcp-server/companies for hiring teams).
 * Server components; the tool lists come straight from the catalogs.
 */
import { Coins, Mail, ShieldCheck, Eye } from "lucide-react";
import ClaudeIcon from "@/components/icons/ClaudeIcon";
import CursorIcon from "@/components/icons/CursorIcon";
import VSCodeIcon from "@/components/icons/VSCodeIcon";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/utils/utils";
import type { ToolApprovalPolicy } from "@/helpers/agent/approval";
import { mcpToolFlags, type McpToolDef } from "@/helpers/mcp/tools";
import { MCP_SERVER_URL } from "@/helpers/marketing/content";
import CopyButton from "./CopyButton";

/** The production URL, whatever environment renders the page. */
export const MCP_URL = MCP_SERVER_URL;

export const CLAUDE_CODE_COMMAND = `claude mcp add --transport http gethired ${MCP_URL}`;

export type McpClient = {
  id: "claude" | "claude-code" | "cursor" | "vscode";
  name: string;
  steps: string;
  /** What to paste. Clients without a config take the server URL. */
  code: string;
};

export const MCP_CLIENTS: McpClient[] = [
  {
    id: "claude",
    name: "Claude (web and desktop)",
    steps:
      "Open Settings → Connectors → Add custom connector, paste the URL and choose Connect. Sign in to GetHired and approve the request.",
    code: MCP_URL,
  },
  {
    id: "claude-code",
    name: "Claude Code",
    steps: "Add the server, then run /mcp in Claude Code and choose Authenticate.",
    code: CLAUDE_CODE_COMMAND,
  },
  {
    id: "cursor",
    name: "Cursor",
    steps:
      "Add this to ~/.cursor/mcp.json (or .cursor/mcp.json in a project), then choose Connect next to gethired in Cursor's MCP settings.",
    code: JSON.stringify({ mcpServers: { gethired: { url: MCP_URL } } }, null, 2),
  },
  {
    id: "vscode",
    name: "VS Code",
    steps:
      "Add this to .vscode/mcp.json (or run MCP: Add Server), then start the server and sign in when VS Code asks.",
    code: JSON.stringify({ servers: { gethired: { type: "http", url: MCP_URL } } }, null, 2),
  },
];

/** A client's own mark. */
export function McpClientIcon({ id, className }: { id: McpClient["id"]; className?: string }) {
  if (id === "cursor") return <CursorIcon className={className} />;
  if (id === "vscode") return <VSCodeIcon className={className} />;
  return <ClaudeIcon className={className} />;
}

/** A code block with a copy button. */
export function CodeBlock({
  children,
  className,
  copyLabel = "Copy",
}: {
  children: string;
  className?: string;
  copyLabel?: string;
}) {
  return (
    <div className={cn("relative min-w-0 max-w-full rounded-lg border bg-muted/30 text-left", className)}>
      <pre className="overflow-x-auto py-3 pl-4 pr-12 font-mono text-[13px] leading-6">
        <code>{children}</code>
      </pre>
      <CopyButton value={children} label={copyLabel} className="absolute right-1.5 top-1.5" />
    </div>
  );
}

export function McpSection({
  title,
  description,
  children,
  id,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className="flex scroll-mt-20 flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        {description && <p className="max-w-3xl text-[15px] leading-7 text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}

/** Step-by-step setup for each client, as a grid of cards. */
export function McpClientSetup() {
  return (
    <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {MCP_CLIENTS.map((client) => (
        <li key={client.id} className="flex min-w-0 flex-col gap-3 rounded-xl border bg-background p-4 sm:p-5">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border bg-muted/40">
              <McpClientIcon id={client.id} />
            </span>
            <h3 className="font-medium">{client.name}</h3>
          </div>
          <p className="text-sm leading-6 text-muted-foreground">{client.steps}</p>
          <CodeBlock className="mt-auto" copyLabel={`Copy ${client.name} setup`}>
            {client.code}
          </CodeBlock>
        </li>
      ))}
    </ul>
  );
}

const BADGE_ICON = "h-3 w-3";

/** A catalog's tools, badged from their flags: one bordered list, two columns on wide screens. */
export function McpToolList({
  tools,
  policy,
}: {
  // Either catalog's rows.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools: readonly McpToolDef<any, any, any>[];
  policy: ToolApprovalPolicy;
}) {
  return (
    <ul
      className={cn(
        "grid grid-cols-1 overflow-hidden rounded-xl border bg-background lg:grid-cols-2",
        // Dividers: every row but the last has a bottom border; on two columns the
        // left column gets a right border and the last row loses its bottom one.
        "[&>li:last-child]:border-b-0 lg:[&>li:nth-child(odd)]:border-r",
        "lg:[&>li:nth-last-child(2):nth-child(odd)]:border-b-0",
      )}
    >
      {tools.map((tool) => {
        const { credit, confirm } = mcpToolFlags(tool, policy);
        return (
          <li
            key={tool.name}
            className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b px-4 py-3 transition-colors hover:bg-muted/40"
          >
            <code className="break-all font-mono text-[13px] font-medium">{tool.name}</code>
            <span className="text-sm text-muted-foreground">{tool.title}</span>
            <span className="flex flex-wrap gap-1.5 sm:ml-auto">
              {tool.annotations.readOnlyHint && (
                <Badge variant="outline" className="gap-1 font-normal text-muted-foreground">
                  <Eye className={BADGE_ICON} aria-hidden />
                  <span>Read-only</span>
                </Badge>
              )}
              {confirm && (
                <Badge variant="outline" className="gap-1">
                  <ShieldCheck className={BADGE_ICON} aria-hidden />
                  <span>Asks first</span>
                </Badge>
              )}
              {credit && (
                <Badge variant="outline" className="gap-1">
                  <Coins className={BADGE_ICON} aria-hidden />
                  <span>Credits</span>
                </Badge>
              )}
              {tool.email && (
                <Badge variant="outline" className="gap-1">
                  <Mail className={BADGE_ICON} aria-hidden />
                  <span>Emails</span>
                </Badge>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
