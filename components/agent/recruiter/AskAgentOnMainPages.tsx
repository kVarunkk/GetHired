"use client";

import { COMPANY_AGENT_PATH } from "@/helpers/agent/prompt-draft";
import AskAgentBox, { type AgentSuggestion } from "../AskAgentBox";

// The company main pages' entry points to the recruiter agent (job posts,
// applicants, profiles, outreach, billing, settings). Each suggestion maps to a recruiter
// tool, and the page passes the `can(...)` / `canAny(...)` booleans that hide
// the ones the viewer's permissions don't give the agent.

const when = (allowed: boolean, suggestion: AgentSuggestion) => (allowed ? [suggestion] : []);

export function jobPostsSuggestions(p: {
  canCreate: boolean;
  canViewApplicants: boolean;
  canPublish: boolean;
  canMatch: boolean;
}): AgentSuggestion[] {
  return [
    ...when(p.canCreate, {
      label: "Draft a job post",
      prompt: "Help me write a new job post. Ask me about the role first, then draft it for me to review.",
    }),
    ...when(p.canViewApplicants, {
      label: "Which jobs need attention?",
      prompt:
        "Go through my active job posts and tell me which need attention: few applicants, applicants nobody has looked at, or people stuck in a stage.",
    }),
    ...when(p.canMatch, {
      label: "Find candidates for a job",
      prompt: "Find the best-matching candidates for one of my active job posts. List my jobs and ask me which one.",
    }),
    ...when(p.canPublish, {
      label: "Close stale jobs",
      prompt: "Which of my active job posts are older than 30 days with few applicants? Suggest which to close.",
    }),
  ];
}

export function AskAgentAboutJobPosts(props: Parameters<typeof jobPostsSuggestions>[0]) {
  return (
    <AskAgentBox
      title="Let the agent handle your job posts"
      placeholder={
        props.canCreate ? "Write a job post for a senior Go engineer in Bangalore…" : "Which of my jobs has the most applicants?…"
      }
      basePath={COMPANY_AGENT_PATH}
      suggestions={jobPostsSuggestions(props)}
      toPrompt={(question) => `About my job posts: ${question.trim()}`}
    />
  );
}

export function applicantsSuggestions(p: {
  canView: boolean;
  canScreen: boolean;
  canMove: boolean;
}): AgentSuggestion[] {
  return [
    ...when(p.canView, {
      label: "Who should I review first?",
      prompt: "Across my active jobs, which applicants should I review first, and why?",
    }),
    ...when(p.canView, {
      label: "Where is each job stuck?",
      prompt: "Show me the hiring funnel for each of my active jobs and where applicants are getting stuck.",
    }),
    ...when(p.canScreen, {
      label: "Screen new applicants",
      prompt: "Screen the applicants nobody has screened yet on my active jobs. Ask me which jobs if there are several.",
    }),
    ...when(p.canMove, {
      label: "Move applicants",
      prompt: "Help me move applicants to the next stage. Ask me which job and who, and show me before moving anyone.",
    }),
  ];
}

export function AskAgentAboutApplicants(props: Parameters<typeof applicantsSuggestions>[0]) {
  return (
    <AskAgentBox
      title="Ask the agent about your applicants"
      placeholder="Who are the strongest applicants for my backend job?…"
      basePath={COMPANY_AGENT_PATH}
      suggestions={applicantsSuggestions(props)}
      toPrompt={(question) => `About my applicants: ${question.trim()}`}
    />
  );
}

export function profilesSuggestions(p: {
  canSearch: boolean;
  canMatch: boolean;
  canManageLists: boolean;
}): AgentSuggestion[] {
  return [
    ...when(p.canSearch, {
      label: "Find candidates",
      prompt: "Help me find candidates in the talent pool. Ask me about the role, skills and location first.",
    }),
    ...when(p.canMatch, {
      label: "Match to a job",
      prompt: "Find the best-matching candidates for one of my active job posts. List my jobs and ask me which one.",
    }),
    ...when(p.canSearch, {
      label: "Compare candidates",
      prompt: "Compare the candidates I've saved: their strengths, gaps and which jobs they fit.",
    }),
    ...when(p.canManageLists, {
      label: "Organise my lists",
      prompt: "Show me my talent lists and suggest how to organise the candidates I've saved into them.",
    }),
  ];
}

export function AskAgentAboutProfiles(props: Parameters<typeof profilesSuggestions>[0]) {
  return (
    <AskAgentBox
      title="Let the agent search the talent pool"
      placeholder="Find 5 backend engineers in Bangalore who know Go…"
      basePath={COMPANY_AGENT_PATH}
      suggestions={profilesSuggestions(props)}
      toPrompt={(question) => `About the talent pool: ${question.trim()}`}
    />
  );
}

// getMyCompany is the only billing tool: it reads the plan, credits and limits.
// The agent can't change plans or buy credits.
export const BILLING_SUGGESTIONS: AgentSuggestion[] = [
  { label: "What's left this month?", prompt: "What's left of my plan's limits and AI credits this month?" },
  {
    label: "Which limit is closest?",
    prompt: "Which of my plan's limits am I closest to running out of, and when does the period reset?",
  },
];

export function AskAgentAboutBilling() {
  return (
    <AskAgentBox
      title="Ask the agent about your usage"
      placeholder="How many screenings do I have left?…"
      basePath={COMPANY_AGENT_PATH}
      suggestions={BILLING_SUGGESTIONS}
      toPrompt={(question) => `About my plan and usage: ${question.trim()}`}
    />
  );
}

export function settingsSuggestions(p: {
  canEditStages: boolean;
  canEditTemplates: boolean;
  canEditCareers: boolean;
  canViewTeam: boolean;
}): AgentSuggestion[] {
  return [
    ...when(p.canEditStages, {
      label: "Add a pipeline stage",
      prompt: "Help me add a stage to my hiring pipeline. Show me the current stages and ask where it goes.",
    }),
    ...when(p.canEditTemplates, {
      label: "Write an email template",
      prompt: "Help me write a new email template for candidates. Ask me what it's for first.",
    }),
    ...when(p.canEditTemplates, {
      label: "Review my templates",
      prompt: "Read my email templates and suggest how to make them clearer and warmer.",
    }),
    ...when(p.canEditCareers, {
      label: "Improve my careers page",
      prompt: "Read my careers page and suggest improvements to its text, then make the changes I agree to.",
    }),
    ...when(p.canViewTeam, {
      label: "Who's on my team",
      prompt: "Summarise my team: who's on it, their roles and what each role lets them do.",
    }),
  ];
}

export function AskAgentAboutSettings(props: Parameters<typeof settingsSuggestions>[0]) {
  return (
    <AskAgentBox
      title="Let the agent set things up"
      placeholder="Add a Take-home stage after Screen…"
      basePath={COMPANY_AGENT_PATH}
      suggestions={settingsSuggestions(props)}
      toPrompt={(question) => `About my company settings: ${question.trim()}`}
    />
  );
}

// Shown only with outreach.send, which needs outreach.view and talent.view, so
// every chip's tools (searchCandidates / findMatchesForJob, sendOutreach,
// listOutreach) are open to the viewer. Matching needs matching.run on top.
export function outreachSuggestions(p: { canMatch: boolean }): AgentSuggestion[] {
  return [
    {
      label: "Find candidates and draft outreach",
      prompt: p.canMatch
        ? "Find the best-matching candidates for one of my active job posts and draft outreach to them. List my jobs and ask me which one, and show me each message before sending."
        : "Help me find candidates in the talent pool and draft outreach to them. Ask me about the role first, and show me each message before sending.",
    },
    {
      label: "Who hasn't replied?",
      prompt: "Which of my outreach messages haven't had a reply yet? Group them by job and say when each was sent.",
    },
    {
      label: "How is my outreach doing?",
      prompt: "Summarise my outreach: how many were sent, how many replied or are interested, and which jobs get the best replies.",
    },
  ];
}

export function AskAgentAboutOutreachList(props: Parameters<typeof outreachSuggestions>[0]) {
  return (
    <AskAgentBox
      title="Let the agent reach out for you"
      placeholder="Find 5 React developers for my frontend job and draft a message…"
      basePath={COMPANY_AGENT_PATH}
      suggestions={outreachSuggestions(props)}
      toPrompt={(question) => `About my outreach: ${question.trim()}`}
    />
  );
}
