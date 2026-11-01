"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight } from "lucide-react";
import ClaudeIcon from "@/components/icons/ClaudeIcon";
import CursorIcon from "@/components/icons/CursorIcon";
import VSCodeIcon from "@/components/icons/VSCodeIcon";
import { Button } from "@/components/ui/button";

export type McpAudience = "applicant" | "company";

const COMPANY_PREFIXES = ["/hire", "/pricing/companies", "/company", "/mcp-server/companies"];

/** The MCP pages themselves don't need a banner pointing at them. */
export function isMcpPage(pathname: string) {
  return pathname === "/mcp" || pathname.startsWith("/mcp/") || pathname.startsWith("/mcp-server");
}

export function mcpAudienceFor(pathname: string): McpAudience {
  return COMPANY_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))
    ? "company"
    : "applicant";
}

const CONTENT: Record<McpAudience, { heading: string; subtext: string; href: string }> = {
  applicant: {
    heading: "Job hunt from your AI assistant",
    subtext:
      "Connect GetHired to Claude, Cursor or VS Code to search jobs, check matches and track applications without leaving the chat.",
    href: "/mcp-server",
  },
  company: {
    heading: "Hire from your AI assistant",
    subtext:
      "Connect GetHired to Claude, Cursor or VS Code to post jobs, search candidates and move your pipeline from the chat.",
    href: "/mcp-server/companies",
  },
};

/**
 * A banner that links to the MCP landing page for the visitor's side: the
 * company page on company-facing routes, the job seeker page everywhere else.
 * Pass `audience` to override the path-based choice. Renders nothing on the
 * MCP pages themselves.
 */
export default function McpServerCta({ audience }: { audience?: McpAudience }) {
  const pathname = usePathname() ?? "";
  if (isMcpPage(pathname)) return null;

  const content = CONTENT[audience ?? mcpAudienceFor(pathname)];

  return (
    <section className="flex flex-col items-center gap-6 rounded-2xl border px-6 py-10 text-center sm:flex-row sm:justify-between sm:text-start">
      <div className="flex flex-col items-center gap-3 sm:items-start">
        <div className="flex items-center gap-2 text-muted-foreground" aria-label="Works with Claude, Cursor and VS Code">
          <ClaudeIcon className="h-5 w-5" />
          <CursorIcon className="h-5 w-5" />
          <VSCodeIcon className="h-5 w-5" />
          <span className="text-xs font-medium uppercase tracking-wide">MCP server</span>
        </div>
        <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">{content.heading}</h2>
        <p className="max-w-xl text-[15px] leading-7 text-muted-foreground">{content.subtext}</p>
      </div>

      <Button asChild size="lg" variant="outline" className="w-full shrink-0 px-8 sm:w-auto">
        <Link href={content.href}>
          Connect your assistant
          <ArrowRight className="h-4 w-4" />
        </Link>
      </Button>
    </section>
  );
}
