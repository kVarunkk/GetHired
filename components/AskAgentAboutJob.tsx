"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUp, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { agentPromptHref, savePendingPrompt } from "@/helpers/agent/prompt-draft";

// The job page's AI features, as one entry point to /agent: a question box
// plus suggested prompts. Each opens the agent with the prompt in its message
// box (the user still sends it). The job's link goes in the prompt so the
// agent can pass its id to getJobDetails, createInterview, startResumeReview
// and findSimilarJobs.

type Job = { id: string; job_name: string | null; company_name: string | null };

const jobRef = (job: Job) =>
  `the ${job.job_name ?? "this"} role${job.company_name ? ` at ${job.company_name}` : ""} (/jobs/${job.id})`;

export function jobQuestionPrompt(job: Job, question: string) {
  return `About ${jobRef(job)}: ${question.trim()}`;
}

export function jobSuggestions(job: Job) {
  const ref = jobRef(job);
  return [
    { label: "Mock interview", prompt: `Set up a mock interview for ${ref}.` },
    {
      label: "Tailor my CV",
      prompt: `Review my resume against ${ref} and tell me what to change.`,
    },
    { label: "Similar jobs", prompt: `Find jobs similar to ${ref}.` },
  ];
}

export default function AskAgentAboutJob({ job }: { job: Job }) {
  const router = useRouter();
  const [question, setQuestion] = useState("");

  // Saved too, so the prompt survives a detour through login or sign-up.
  const open = (prompt: string) => {
    savePendingPrompt(prompt);
    router.push(agentPromptHref(prompt));
  };

  return (
    <section
      aria-label="Ask the agent about this job"
      className="flex flex-col gap-3 rounded-xl border p-4"
    >
      <h2 className="flex items-center gap-2 text-sm font-medium">
        <Sparkles className="h-4 w-4 text-muted-foreground" />
        Ask the agent about this job
      </h2>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (question.trim()) open(jobQuestionPrompt(job, question));
        }}
      >
        <div className="flex items-end gap-2 rounded-2xl border bg-background p-2 shadow-sm transition-colors focus-within:border-foreground/30">
          <Textarea
            aria-label="Question about this job"
            value={question}
            rows={1}
            placeholder="Am I a good fit? What does this team work on?…"
            className="max-h-48 min-h-10 resize-none border-0 bg-transparent px-2 py-2 text-[15px] leading-6 shadow-none [field-sizing:content] focus-visible:ring-0 focus-visible:ring-offset-0"
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <Button
            type="submit"
            size="icon"
            variant="brand"
            aria-label="Ask"
            disabled={!question.trim()}
            className="shrink-0 rounded-xl"
          >
            <ArrowUp className="h-4 w-4" />
          </Button>
        </div>
      </form>

      <div role="group" aria-label="Suggested prompts" className="flex flex-wrap gap-2">
        {jobSuggestions(job).map(({ label, prompt }) => (
          <Link
            key={label}
            href={agentPromptHref(prompt)}
            onClick={() => savePendingPrompt(prompt)}
            className="rounded-full border px-3.5 py-1.5 text-sm transition-colors hover:border-brand/40 hover:bg-brandSoft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
          >
            {label}
          </Link>
        ))}
      </div>
    </section>
  );
}
