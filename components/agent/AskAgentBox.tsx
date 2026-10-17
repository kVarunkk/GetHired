"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUp, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { agentPromptHref, savePendingPrompt } from "@/helpers/agent/prompt-draft";

export type AgentSuggestion = { label: string; prompt: string };

/**
 * A question box plus suggested prompts that open the agent at `basePath`
 * (`/agent` or `/company/agent`) with the prompt in its message box (the user
 * still sends it). `toPrompt` turns the typed question into the prompt, e.g. by
 * adding the job post it's about.
 */
export default function AskAgentBox({
  title,
  placeholder,
  basePath,
  suggestions,
  toPrompt = (question) => question.trim(),
}: {
  title: string;
  placeholder: string;
  /** The agent page the prompts open. */
  basePath: string;
  suggestions: AgentSuggestion[];
  toPrompt?: (question: string) => string;
}) {
  const router = useRouter();
  const [question, setQuestion] = useState("");

  const open = (prompt: string) => {
    savePendingPrompt(prompt);
    router.push(agentPromptHref(prompt, basePath));
  };

  return (
    <section aria-label={title} className="flex flex-col gap-3 rounded-xl border p-4">
      <h2 className="flex items-center gap-2 text-sm font-medium">
        <Sparkles className="h-4 w-4 text-muted-foreground" />
        {title}
      </h2>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (question.trim()) open(toPrompt(question));
        }}
      >
        <div className="flex items-end gap-2 rounded-2xl border bg-background p-2 transition-colors focus-within:border-foreground/30">
          <Textarea
            aria-label="Question for the assistant"
            value={question}
            rows={1}
            placeholder={placeholder}
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
        {suggestions.map(({ label, prompt }) => (
          <Link
            key={label}
            href={agentPromptHref(prompt, basePath)}
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
