import type { Metadata } from "next";
import AgentPage, { type AgentPageSearchParams } from "@/components/agent/AgentPage";

export const metadata: Metadata = {
  title: "Agent",
  description: "Chat with your GetHired hiring assistant.",
  robots: { index: false, follow: false },
};

// The companies' agent (plan/recruiter-agent/feature-recruiter-agent-spec.md). Applicants use /agent.
export default function CompanyAgentPage({ searchParams }: { searchParams: AgentPageSearchParams }) {
  return <AgentPage role="company" searchParams={searchParams} />;
}
