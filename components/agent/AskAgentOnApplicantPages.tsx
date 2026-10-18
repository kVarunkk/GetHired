"use client";

import { AGENT_PATH, PROFILE_UPDATE_PROMPT } from "@/helpers/agent/prompt-draft";
import AskAgentBox, { type AgentSuggestion } from "./AskAgentBox";

// The applicant main pages' entry points to the job search agent (jobs,
// resumes, resume reviews, interviews, opportunities, settings). Each
// suggestion maps to a tool in helpers/agent/tools/. The applicant role has no
// outreach tools, so the opportunities helper only offers profile and job ones.

// searchJobs / naturalLanguageJobSearch, findRelevantJobs, listSavedJobs, listApplications.
export const JOBS_SUGGESTIONS: AgentSuggestion[] = [
  { label: "Find remote jobs posted this week", prompt: "Find remote jobs in my field posted this week." },
  { label: "Jobs that match my profile", prompt: "Show jobs that match my profile, best matches first." },
  { label: "My saved jobs", prompt: "List the jobs I've saved and tell me which are still worth applying to." },
  { label: "Where are my applications?", prompt: "What's the status of my applications?" },
];

export function AskAgentAboutJobs() {
  return (
    <AskAgentBox
      title="Let the agent find jobs for you"
      placeholder="Find remote React jobs in Bangalore paying over 20 LPA…"
      basePath={AGENT_PATH}
      suggestions={JOBS_SUGGESTIONS}
    />
  );
}

// listResumes, setPrimaryResume, requestResumeUpload, startResumeReview.
export const RESUMES_SUGGESTIONS: AgentSuggestion[] = [
  { label: "Which resume is my primary?", prompt: "List my resumes and tell me which one is my primary." },
  {
    label: "Change my primary resume",
    prompt: "Help me pick which of my resumes should be my primary one for job matches, then set it.",
  },
  { label: "Upload a new resume", prompt: "I want to upload a new resume." },
  { label: "Review my resume for a job", prompt: "Review my resume against a job I like. Ask me which job first." },
];

export function AskAgentAboutResumes() {
  return (
    <AskAgentBox
      title="Ask the agent about your resumes"
      placeholder="Which of my resumes should I use for backend roles?…"
      basePath={AGENT_PATH}
      suggestions={RESUMES_SUGGESTIONS}
      toPrompt={(question) => `About my resumes: ${question.trim()}`}
    />
  );
}

// startResumeReview (a job or a pasted description), findRelevantJobs.
export const RESUME_REVIEWS_SUGGESTIONS: AgentSuggestion[] = [
  { label: "Review my resume for a job", prompt: "Review my resume against a job I like. Ask me which job first." },
  {
    label: "Review against a job description",
    prompt: "Review my resume against a job description. I'll paste it next.",
  },
  {
    label: "Find jobs to review against",
    prompt: "Find jobs that match my profile, so I can pick one to review my resume against.",
  },
];

export function AskAgentAboutResumeReviews() {
  return (
    <AskAgentBox
      title="Let the agent review your resume"
      placeholder="Review my resume for the Stripe frontend role…"
      basePath={AGENT_PATH}
      suggestions={RESUME_REVIEWS_SUGGESTIONS}
      toPrompt={(question) => `About my resume reviews: ${question.trim()}`}
    />
  );
}

// createInterview, listInterviews, getInterviewAnalysis.
export const INTERVIEWS_SUGGESTIONS: AgentSuggestion[] = [
  {
    label: "Set up a mock interview",
    prompt: "Set up a mock interview for a job I'm preparing for. Ask me which job first.",
  },
  { label: "How did my last interview go?", prompt: "How did my latest mock interview go? Summarise the feedback." },
  {
    label: "What should I practise?",
    prompt: "Look at the feedback from my mock interviews and tell me what to practise next.",
  },
];

export function AskAgentAboutInterviews() {
  return (
    <AskAgentBox
      title="Practise with the agent"
      placeholder="Set up a mock interview for a senior frontend role…"
      basePath={AGENT_PATH}
      suggestions={INTERVIEWS_SUGGESTIONS}
      toPrompt={(question) => `About my mock interviews: ${question.trim()}`}
    />
  );
}

// getMyProfile + updateMyPreferences, findRelevantJobs. No outreach tools exist.
export const OPPORTUNITIES_SUGGESTIONS: AgentSuggestion[] = [
  {
    label: "Help companies find me",
    prompt:
      "Review my profile and suggest changes to my roles, skills and preferences that would help companies find me. Update it once I agree.",
  },
  { label: "Jobs that match my profile", prompt: "Show jobs that match my profile, best matches first." },
];

export function AskAgentAboutOpportunities() {
  return (
    <AskAgentBox
      title="Get found by more companies"
      placeholder="What should I add to my profile for fintech roles?…"
      basePath={AGENT_PATH}
      suggestions={OPPORTUNITIES_SUGGESTIONS}
    />
  );
}

// getMyProfile + updateMyPreferences. Privacy and email settings have no tools.
export const SETTINGS_SUGGESTIONS: AgentSuggestion[] = [
  { label: "Review my profile", prompt: PROFILE_UPDATE_PROMPT },
  {
    label: "Change my job preferences",
    prompt: "Help me update my job preferences: roles, locations, salary and job types. Ask me what to change.",
  },
];

export function AskAgentAboutSettings() {
  return (
    <AskAgentBox
      title="Let the agent update your profile"
      placeholder="Add Remote to my work style and raise my minimum salary…"
      basePath={AGENT_PATH}
      suggestions={SETTINGS_SUGGESTIONS}
      toPrompt={(question) => `About my profile: ${question.trim()}`}
    />
  );
}
