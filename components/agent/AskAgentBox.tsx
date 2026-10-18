"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUp, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { agentPromptHref, savePendingPrompt } from "@/helpers/agent/prompt-draft";
import { cn } from "@/utils/utils";

export type AgentSuggestion = { label: string; prompt: string };

/** Timings (ms) of the placeholder that types through the suggestions. */
export const TYPEWRITER = { start: 1200, type: 45, hold: 1800, erase: 20 };

type TypeStep = { index: number; length: number; erasing: boolean };

/**
 * Types each phrase out, holds it, erases it and moves to the next, while
 * `active`. Returns null before the first character, so the caller can show
 * its static text instead. Pausing keeps the position.
 */
function useTypewriter(phrases: string[], active: boolean): string | null {
  const [step, setStep] = useState<TypeStep | null>(null);
  const key = phrases.join("\n");

  useEffect(() => {
    const list = key ? key.split("\n") : [];
    if (!active || list.length === 0) return;

    let next: TypeStep;
    let delay: number;
    if (!step) {
      next = { index: 0, length: 1, erasing: false };
      delay = TYPEWRITER.start;
    } else if (!step.erasing && step.length < list[step.index].length) {
      next = { ...step, length: step.length + 1 };
      delay = TYPEWRITER.type;
    } else if (!step.erasing) {
      next = { ...step, erasing: true };
      delay = TYPEWRITER.hold;
    } else if (step.length > 0) {
      next = { ...step, length: step.length - 1 };
      delay = TYPEWRITER.erase;
    } else {
      next = { index: (step.index + 1) % list.length, length: 1, erasing: false };
      delay = TYPEWRITER.type;
    }

    const timer = setTimeout(() => setStep(next), delay);
    return () => clearTimeout(timer);
  }, [key, active, step]);

  if (!step) return null;
  return key.split("\n")[step.index]?.slice(0, step.length) ?? null;
}

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
  const [focused, setFocused] = useState(false);
  // The examples stop for good once the user has typed something.
  const [typed, setTyped] = useState(false);
  const typing = !focused && !typed;
  const example = useTypewriter(
    suggestions.map(({ label }) => label),
    typing,
  );

  const open = (prompt: string) => {
    savePendingPrompt(prompt);
    router.push(agentPromptHref(prompt, basePath));
  };

  return (
    <section aria-label={title} className="agent-glow flex flex-col gap-3 rounded-xl p-4">
      <h2 className="flex items-center gap-2.5 text-sm font-semibold">
        <span className="agent-mark flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-brand/30 bg-brandSoft">
          <Sparkles className="h-4 w-4 text-brand" />
          <span aria-hidden className="agent-orbit absolute inset-[-5px]">
            <span className="absolute left-1/2 top-0 h-1 w-1 -translate-x-1/2 rounded-full bg-brand" />
          </span>
        </span>
        {title}
      </h2>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (question.trim()) open(toPrompt(question));
        }}
      >
        <div className="flex items-end gap-2 rounded-2xl border bg-background p-2 transition-colors focus-within:border-brand/40">
          <Textarea
            aria-label="Question for the assistant"
            value={question}
            rows={1}
            placeholder={typing && example !== null ? example : placeholder}
            className={cn(
              "max-h-48 min-h-10 resize-none border-0 bg-transparent px-2 py-2 text-[15px] leading-6 shadow-none [field-sizing:content] focus-visible:ring-0 focus-visible:ring-offset-0",
              // While empty, the box only shows the placeholder: keep it to one
              // truncated line, so a long example doesn't grow the box and
              // shift the page as it types.
              !question && "h-10 overflow-hidden [field-sizing:fixed] placeholder:truncate",
            )}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onChange={(event) => {
              setQuestion(event.target.value);
              if (event.target.value) setTyped(true);
            }}
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
        {suggestions.map(({ label, prompt }, index) => (
          <Link
            key={label}
            href={agentPromptHref(prompt, basePath)}
            onClick={() => savePendingPrompt(prompt)}
            style={{ animationDelay: `${index * 60}ms` }}
            className="agent-chip-in rounded-full border bg-background px-3.5 py-1.5 text-sm transition-colors hover:border-brand/40 hover:bg-brandSoft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
          >
            {label}
          </Link>
        ))}
      </div>
    </section>
  );
}
