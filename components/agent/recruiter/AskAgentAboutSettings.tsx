"use client";

import { COMPANY_AGENT_PATH } from "@/helpers/agent/prompt-draft";
import AskAgentBox, { type AgentSuggestion } from "../AskAgentBox";

// The Pipelines, Email templates and Careers page settings' entry points (and
// a job's Pipeline section) to the recruiter agent. Each chip maps to the section's tools, and the page
// passes the `can(...)` booleans that hide the ones the viewer can't use.
// Scheduling link and Notifications have no agent tools, so no box.

const when = (allowed: boolean, suggestion: AgentSuggestion) => (allowed ? [suggestion] : []);

type StagesAllowed = {
  canViewStages: boolean;
  canEditStages: boolean;
  /**
   * The pipeline the page edits (its stage editor, JPT-037). Without one
   * (the Pipelines list), the chips ask the agent to find the pipeline first.
   */
  pipeline?: { id: string; name: string };
};

/** How a prompt names the pipeline: by name and id on its editor, or "one of my pipelines". */
const pipelineRef = (pipeline: StagesAllowed["pipeline"]) =>
  pipeline ? `the "${pipeline.name}" pipeline (pipeline ${pipeline.id})` : null;

/**
 * listStages / listPipelines need applicants.view; createPipeline and the
 * stage tools (createStage / reorderStages / archiveStage, which take a
 * pipelineId) need settings.stages.
 */
export function stagesSuggestions(p: StagesAllowed): AgentSuggestion[] {
  const ref = pipelineRef(p.pipeline);
  return [
    // createPipeline, on the list only.
    ...when(p.canEditStages && !ref, {
      label: "Create a pipeline",
      prompt:
        "Help me create a new pipeline for jobs that hire differently. Ask me what it's for, copy the closest of my pipelines, then help me set up its stages.",
    }),
    ...when(p.canEditStages, {
      label: "Add a stage",
      prompt: ref
        ? `Help me add a stage to ${ref}. Show me its stages, tell me how many jobs use it, and ask where the new one goes.`
        : "Help me add a stage to one of my pipelines. List my pipelines and ask which one first, then show me its stages and ask where the new one goes.",
    }),
    ...when(p.canEditStages, {
      label: "Reorder stages",
      prompt: ref
        ? `Show me the stages of ${ref} and help me put them in a new order.`
        : "Help me reorder the stages of one of my pipelines. List my pipelines and ask which one first.",
    }),
    ...when(p.canEditStages, {
      label: "Archive a stage",
      prompt: ref
        ? `Which stages of ${ref} are empty? Help me archive one I no longer use.`
        : "Which stages of my pipelines are empty? Help me archive one I no longer use.",
    }),
    ...when(p.canViewStages && !p.canEditStages, {
      label: ref ? "Explain this pipeline" : "Explain my pipelines",
      prompt: ref
        ? `Show me the stages of ${ref}, what candidates see in each one, and which jobs use it.`
        : "Show me my pipelines, which jobs use each one, and what candidates see in each stage.",
    }),
  ];
}

export function AskAgentAboutStages(props: StagesAllowed) {
  const ref = pipelineRef(props.pipeline);
  return (
    <AskAgentBox
      title={ref ? "Let the agent set up this pipeline" : "Let the agent set up your pipelines"}
      placeholder="Add a Take-home stage after Screen…"
      basePath={COMPANY_AGENT_PATH}
      suggestions={stagesSuggestions(props)}
      toPrompt={(question) => `About ${ref ?? "my pipelines"}: ${question.trim()}`}
    />
  );
}

type JobPipelineAllowed = {
  job: { id: string; title: string };
  pipelineName: string;
  /** jobs.edit on the job (setJobPipeline), and another active pipeline to move to. */
  canSwitch: boolean;
  /** settings.stages (customizeJobPipeline, then createStage on the copy). */
  canCustomize: boolean;
  /** applicants.view (listStages with the job). */
  canViewStages: boolean;
};

const jobRef = (job: JobPipelineAllowed["job"]) => `"${job.title}" (job post ${job.id})`;

/** The job's Pipeline section (JPT-035, spec §3.3): switch it, or give it its own stages. */
export function jobPipelineSuggestions(p: JobPipelineAllowed): AgentSuggestion[] {
  const ref = jobRef(p.job);
  return [
    ...when(p.canSwitch, {
      label: "Switch this job to another pipeline",
      prompt: `List my pipelines and help me move ${ref} off "${p.pipelineName}" onto another one. Show me where each stage's candidates would go before switching.`,
    }),
    ...when(p.canCustomize, {
      label: "Add a stage just for this job",
      prompt: `I want a stage only for ${ref}, without changing the other jobs on "${p.pipelineName}". Give the job its own pipeline if other jobs share it, then help me add the stage and ask where it goes.`,
    }),
    ...when(p.canViewStages && !p.canSwitch && !p.canCustomize, {
      label: "Explain this job's pipeline",
      prompt: `Show me the stages of the pipeline ${ref} uses and what candidates see in each one.`,
    }),
  ];
}

export function AskAgentAboutJobPipeline(props: JobPipelineAllowed) {
  return (
    <AskAgentBox
      title="Ask the agent about this job's pipeline"
      placeholder="Add a Take-home stage after Screen for this job only…"
      basePath={COMPANY_AGENT_PATH}
      suggestions={jobPipelineSuggestions(props)}
      toPrompt={(question) => `About the pipeline of my job post ${jobRef(props.job)}: ${question.trim()}`}
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
