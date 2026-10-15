import type { Metadata } from "next";
import AgentPage, { type AgentPageSearchParams } from "@/components/agent/AgentPage";

export const metadata: Metadata = {
  title: "Agent",
  description: "Chat with your GetHired job-search assistant.",
  robots: { index: false, follow: false },
};

// The applicants' agent. Companies use /company/agent.
export default function ApplicantAgentPage({ searchParams }: { searchParams: AgentPageSearchParams }) {
  return <AgentPage role="applicant" searchParams={searchParams} />;
}
