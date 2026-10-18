"use client";

import { AGENT_PATH } from "@/helpers/agent/prompt-draft";
import AskAgentBox, { type AgentSuggestion } from "./AskAgentBox";

// The applicant id pages' entry points to the job search agent (resume,
// resume review, interview analysis). The entity's id goes in each prompt so
// the agent can pass it to its tools; each suggestion maps to a tool in
// helpers/agent/tools/. The opportunity page reuses AskAgentAboutJob, because
// the applicant role has no outreach tools.

const when = (allowed: boolean, suggestion: AgentSuggestion) => (allowed ? [suggestion] : []);

type Resume = { id: string; name: string; isPrimary: boolean; parsingFailed: boolean };

const resumeRef = (resume: Resume) => `my resume "${resume.name}" (resume ${resume.id})`;

export function resumeSuggestions(resume: Resume): AgentSuggestion[] {
  const ref = resumeRef(resume);
  return [
    // startResumeReview (refuses a resume that failed to parse)
    ...when(!resume.parsingFailed, {
      label: "Review it for a job",
      prompt: `Review ${ref} against a job I like. Ask me which job first.`,
    }),
    // createInterview
    ...when(!resume.parsingFailed, {
      label: "Mock interview with it",
      prompt: `Set up a mock interview using ${ref}. Ask me which job first.`,
    }),
    // setPrimaryResume
    ...when(!resume.isPrimary, {
      label: "Make it my primary resume",
      prompt: `Make ${ref} my primary resume.`,
    }),
  ];
}

export function AskAgentAboutResume({ resume }: { resume: Resume }) {
  return (
    <AskAgentBox
      title="Ask the agent about this resume"
      placeholder="Is this resume a good fit for backend roles?…"
      basePath={AGENT_PATH}
      suggestions={resumeSuggestions(resume)}
      toPrompt={(question) => `About ${resumeRef(resume)}: ${question.trim()}`}
    />
  );
}

type Review = { id: string; name: string | null; jobId: string | null };

const reviewRef = (review: Review) =>
  `my resume review${review.name ? ` "${review.name}"` : ""} (review ${review.id})`;

export function resumeReviewSuggestions(review: Review): AgentSuggestion[] {
  const ref = reviewRef(review);
  return [
    // getResumeReview
    { label: "Summarise this review", prompt: `Summarise ${ref}: the score and the overall feedback.` },
    { label: "What should I fix first?", prompt: `Go through ${ref} and tell me what to fix first.` },
    // findSimilarJobs
    ...when(review.jobId !== null, {
      label: "Similar jobs",
      prompt: `Find jobs similar to the one in ${ref} (/jobs/${review.jobId}).`,
    }),
  ];
}

export function AskAgentAboutResumeReview({ review }: { review: Review }) {
  return (
    <AskAgentBox
      title="Ask the agent about this review"
      placeholder="Rewrite my summary using these suggestions…"
      basePath={AGENT_PATH}
      suggestions={resumeReviewSuggestions(review)}
      toPrompt={(question) => `About ${reviewRef(review)}: ${question.trim()}`}
    />
  );
}

type Session = { interviewId: string; sessionId: string; interviewName: string; hasEarlier: boolean };

const sessionRef = (s: Session) =>
  `my "${s.interviewName}" mock interview session (interview ${s.interviewId}, session ${s.sessionId})`;

export function interviewAnalysisSuggestions(session: Session): AgentSuggestion[] {
  const ref = sessionRef(session);
  return [
    // getInterviewAnalysis
    { label: "Summarise the feedback", prompt: `Summarise the feedback from ${ref}.` },
    {
      label: "What should I practise?",
      prompt: `Look at the feedback from ${ref} and give me a short practice plan.`,
    },
    // listInterviews + getInterviewAnalysis
    ...when(session.hasEarlier, {
      label: "Am I improving?",
      prompt: `Compare ${ref} with my earlier sessions of the same interview. Am I improving?`,
    }),
  ];
}

export function AskAgentAboutInterviewAnalysis({ session }: { session: Session }) {
  return (
    <AskAgentBox
      title="Ask the agent about this session"
      placeholder="How could I have answered the system design question better?…"
      basePath={AGENT_PATH}
      suggestions={interviewAnalysisSuggestions(session)}
      toPrompt={(question) => `About ${sessionRef(session)}: ${question.trim()}`}
    />
  );
}
