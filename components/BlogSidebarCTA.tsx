"use client";

import { FileCheck2, ListChecks, Mic } from "lucide-react";
import { platforms } from "@/utils/utils";
import { AGENT_PATH } from "@/helpers/agent/prompt-draft";
import BlogSidebarAgentCTA from "./BlogSidebarAgentCTA";

// The sidebar CTA on posts written for job seekers.
export default function BlogSidebarCTA() {
  return (
    <BlogSidebarAgentCTA
      title="Let the AI agent run your job search"
      description={`Ask in plain words. The agent searches jobs from ${platforms.length} ATS platforms like Greenhouse, Workday and Ashby, matched to your resume.`}
      agentPath={AGENT_PATH}
      primary={{
        label: "Find jobs that match me",
        prompt: "Find jobs that match my profile, best matches first.",
      }}
      prompts={[
        {
          label: "Review my resume for ATS issues",
          prompt: "Review my resume and suggest improvements for ATS.",
          icon: FileCheck2,
        },
        {
          label: "Set up a mock interview",
          prompt: "Set up a mock interview for the role I'm targeting.",
          icon: Mic,
        },
        {
          label: "Track my applications",
          prompt: "Show my applications, saved jobs and upcoming interviews.",
          icon: ListChecks,
        },
      ]}
    />
  );
}
