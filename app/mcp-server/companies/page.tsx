import type { Metadata } from "next";
import McpLandingPage from "@/components/mcp/McpLandingPage";
import { LANDING_PAGES, markdownAlternate } from "@/helpers/marketing/content";

const page = { ...LANDING_PAGES["mcp-server-companies"], mcp: "company" as const };

const TITLE = "MCP Server for Hiring Teams";

export const metadata: Metadata = {
  title: TITLE,
  description: page.description,
  alternates: {
    canonical: page.path,
    types: markdownAlternate(page.path),
  },
  openGraph: {
    type: "website",
    siteName: "GetHired",
    title: TITLE,
    description: page.description,
    url: page.path,
  },
  twitter: { card: "summary", title: TITLE, description: page.description },
  keywords: [
    "recruiting MCP server",
    "AI recruiting in Claude",
    "ATS MCP",
    "hiring with Cursor",
    "GetHired for companies",
  ],
};

export const dynamic = "force-static";

export default function McpServerCompaniesPage() {
  // The hiring page doesn't use the job count.
  return <McpLandingPage page={page} jobCount={0} />;
}
