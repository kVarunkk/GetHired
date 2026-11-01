import type { Metadata } from "next";
import McpLandingPage from "@/components/mcp/McpLandingPage";
import { LANDING_PAGES, markdownAlternate } from "@/helpers/marketing/content";
import { getPlatformStats } from "@/utils/platform-stats";

const page = { ...LANDING_PAGES["mcp-server"], mcp: "applicant" as const };

const TITLE = "MCP Server for Your Job Search";

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
    "GetHired MCP server",
    "MCP job search",
    "Claude job search",
    "Cursor MCP",
    "AI job application",
  ],
};

export const revalidate = 86400;
export const dynamic = "force-static";

export default async function McpServerPage() {
  const { jobCount } = await getPlatformStats();
  return <McpLandingPage page={page} jobCount={jobCount} />;
}
