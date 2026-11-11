"use client";

import { FileUp, KanbanSquare, Users } from "lucide-react";
import { COMPANY_AGENT_PATH } from "@/helpers/agent/prompt-draft";
import BlogSidebarAgentCTA from "./BlogSidebarAgentCTA";

// The sidebar CTA on posts written for companies.
export default function BlogSidebarCompanyCTA() {
  return (
    <BlogSidebarAgentCTA
      title="Hire with an AI recruiter agent"
      description="Tell the agent what you need. It posts roles, ranks candidates with reasons, and handles screening and outreach."
      agentPath={COMPANY_AGENT_PATH}
      primary={{
        label: "Post a job with the agent",
        prompt: "Help me post a new job. Ask me about the role first.",
      }}
      prompts={[
        {
          label: "Find candidates for my open jobs",
          prompt: "Find candidates who match my open jobs.",
          icon: Users,
        },
        {
          label: "Import resumes or a spreadsheet",
          prompt: "Help me import candidates from resumes or a spreadsheet.",
          icon: FileUp,
        },
        {
          label: "Summarise my hiring pipeline",
          prompt: "Summarise my hiring funnel and who's waiting for review.",
          icon: KanbanSquare,
        },
      ]}
    />
  );
}
