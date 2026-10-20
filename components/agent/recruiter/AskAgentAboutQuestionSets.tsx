"use client";

import { COMPANY_AGENT_PATH } from "@/helpers/agent/prompt-draft";
import AskAgentBox, { type AgentSuggestion } from "../AskAgentBox";

// The question sets pages' entry point to the recruiter agent (AF-REQ-004).
// On one set's page its id goes in each prompt, so the agent can find it with
// listQuestionSets and pass it to applyQuestionSet / saveQuestionSet.

type QuestionSetRef = { id: string; name: string };

const setRef = (set: QuestionSetRef) => `my question set "${set.name}" (question set ${set.id})`;

export function questionSetQuestionPrompt(set: QuestionSetRef | undefined, question: string) {
  return set ? `About ${setRef(set)}: ${question.trim()}` : `About my question sets: ${question.trim()}`;
}

/** `canManage` (question_sets.manage) hides the prompts that save or change a set. */
export function questionSetSuggestions(set: QuestionSetRef | undefined, canManage: boolean): AgentSuggestion[] {
  if (set) {
    const ref = setRef(set);
    return [
      ...(canManage
        ? [{ label: "Improve this set", prompt: `Review ${ref} and suggest better questions and knockout rules, then update it.` }]
        : []),
      { label: "Apply to a job", prompt: `Apply ${ref} to one of my job posts. Ask me which one first.` },
      { label: "Check for fairness", prompt: `Check ${ref} for questions that could screen out candidates unfairly.` },
    ];
  }
  return [
    ...(canManage
      ? [
          {
            label: "Draft a new set",
            prompt: "Help me create a new question set. Ask me what role it's for, then draft the questions and knockout rules and save it.",
          },
          {
            label: "Save a job's form",
            prompt: "List my job posts and help me save one's application form as a reusable question set.",
          },
        ]
      : []),
    { label: "Apply a set to a job", prompt: "Help me apply one of my question sets to a job post." },
  ];
}

export default function AskAgentAboutQuestionSets({
  set,
  canManage,
}: {
  /** The set the page shows; omit on the list and new-set pages. */
  set?: QuestionSetRef;
  canManage: boolean;
}) {
  return (
    <AskAgentBox
      title={set ? "Ask the agent about this set" : "Let the agent manage your question sets"}
      placeholder={
        set
          ? "Add a question about notice period with a knockout over 60 days…"
          : "Create a set for backend engineers with a Go experience question…"
      }
      basePath={COMPANY_AGENT_PATH}
      suggestions={questionSetSuggestions(set, canManage)}
      toPrompt={(question) => questionSetQuestionPrompt(set, question)}
    />
  );
}
