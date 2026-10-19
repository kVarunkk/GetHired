"use client";

import { COMPANY_AGENT_PATH } from "@/helpers/agent/prompt-draft";
import AskAgentBox, { type AgentSuggestion } from "../AskAgentBox";

// The Pipeline stages, Email templates and Careers page settings' entry points
// to the recruiter agent. Each chip maps to the section's tools, and the page
// passes the `can(...)` booleans that hide the ones the viewer can't use.
// Scheduling link and Notifications have no agent tools, so no box.

const when = (allowed: boolean, suggestion: AgentSuggestion) => (allowed ? [suggestion] : []);

/** listStages needs applicants.view; createStage / reorderStages / archiveStage need settings.stages. */
export function stagesSuggestions(p: { canViewStages: boolean; canEditStages: boolean }): AgentSuggestion[] {
  return [
    ...when(p.canEditStages, {
      label: "Add a stage",
      prompt: "Help me add a stage to my hiring pipeline. Show me the current stages and ask where it goes.",
    }),
    ...when(p.canEditStages, {
      label: "Reorder my pipeline",
      prompt: "Show me my pipeline stages and help me put them in a new order.",
    }),
    ...when(p.canEditStages, {
      label: "Archive a stage",
      prompt: "Which of my pipeline stages are empty? Help me archive one I no longer use.",
    }),
    ...when(p.canViewStages && !p.canEditStages, {
      label: "Explain my pipeline",
      prompt: "Show me my pipeline stages and what candidates see in each one.",
    }),
  ];
}

export function AskAgentAboutStages(props: Parameters<typeof stagesSuggestions>[0]) {
  return (
    <AskAgentBox
      title="Let the agent set up your pipeline"
      placeholder="Add a Take-home stage after Screen…"
      basePath={COMPANY_AGENT_PATH}
      suggestions={stagesSuggestions(props)}
      toPrompt={(question) => `About my pipeline stages: ${question.trim()}`}
    />
  );
}

// Every template tool needs settings.templates, so the page shows this box only with it.
export const TEMPLATE_SUGGESTIONS: AgentSuggestion[] = [
  {
    label: "Write a template",
    prompt: "Help me write a new email template for candidates. Ask me what it's for first.",
  },
  {
    label: "Review my templates",
    prompt: "Read my email templates and suggest how to make them clearer and warmer, then make the changes I agree to.",
  },
  {
    label: "Personalise a template",
    prompt: "Help me edit one of my email templates to use the candidate's name, the job title and my scheduling link.",
  },
];

export function AskAgentAboutTemplates() {
  return (
    <AskAgentBox
      title="Let the agent write your emails"
      placeholder="Make the rejection email shorter and kinder…"
      basePath={COMPANY_AGENT_PATH}
      suggestions={TEMPLATE_SUGGESTIONS}
      toPrompt={(question) => `About my email templates: ${question.trim()}`}
    />
  );
}

/** getCareersPage is open to everyone with agent.use; the edits need careers.edit. */
export function careersSuggestions(p: { canEdit: boolean }): AgentSuggestion[] {
  if (!p.canEdit) {
    return [
      {
        label: "Review my careers page",
        prompt: "Read my careers page and suggest improvements to its text and sections.",
      },
    ];
  }
  return [
    {
      label: "Improve my careers page",
      prompt: "Read my careers page and suggest improvements to its text, then make the changes I agree to.",
    },
    {
      label: "Write a Perks section",
      prompt: "Help me write a Perks section for my careers page. Ask me what we offer first.",
    },
    {
      label: "Get it ready to publish",
      prompt: "Check my careers page is ready to go live, tell me what's missing, and publish it when I say so.",
    },
  ];
}

export function AskAgentAboutCareers(props: Parameters<typeof careersSuggestions>[0]) {
  return (
    <AskAgentBox
      title={props.canEdit ? "Let the agent build your careers page" : "Ask the agent about your careers page"}
      placeholder={props.canEdit ? "Write an About section that sounds like us…" : "What does our careers page say about remote work?…"}
      basePath={COMPANY_AGENT_PATH}
      suggestions={careersSuggestions(props)}
      toPrompt={(question) => `About my careers page: ${question.trim()}`}
    />
  );
}
