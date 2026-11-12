"use client";

import Link from "next/link";
import { ArrowRight, type LucideIcon } from "lucide-react";
import { Button } from "./ui/button";
import { agentPromptHref, savePendingPrompt } from "@/helpers/agent/prompt-draft";

export type BlogAgentPrompt = {
  /** What the link says. */
  label: string;
  /** What the agent is asked. */
  prompt: string;
  icon: LucideIcon;
};

// The blog post's right-rail CTA. Every link opens the agent with a prompt.
// The prompt is also saved on click, so it survives a detour through login
// (the company login drops the query string).
export default function BlogSidebarAgentCTA({
  title,
  description,
  agentPath,
  primary,
  prompts,
}: {
  title: string;
  description: string;
  agentPath: string;
  primary: { label: string; prompt: string };
  prompts: BlogAgentPrompt[];
}) {
  return (
    <div className="rounded-xl border bg-card p-5">
      <h2 className="text-lg font-semibold tracking-tight leading-snug">
        {title}
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
      <Button asChild variant="brand" className="mt-4 w-full">
        <Link
          href={agentPromptHref(primary.prompt, agentPath)}
          onClick={() => savePendingPrompt(primary.prompt)}
        >
          {primary.label}
          <ArrowRight className="ms-2 h-4 w-4" />
        </Link>
      </Button>

      <p className="mt-5 border-t pt-4 text-xs font-medium text-muted-foreground">
        Or ask the agent to
      </p>
      <ul className="mt-2 space-y-1">
        {prompts.map(({ label, prompt, icon: Icon }) => (
          <li key={label}>
            <Link
              href={agentPromptHref(prompt, agentPath)}
              onClick={() => savePendingPrompt(prompt)}
              className="flex items-center gap-3 rounded-md px-2 py-2 text-sm underline underline-offset-4 transition-colors hover:bg-muted"
            >
              <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
