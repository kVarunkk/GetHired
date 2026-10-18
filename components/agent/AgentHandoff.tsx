"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/utils/utils";
import { agentPromptHref, savePendingPrompt } from "@/helpers/agent/prompt-draft";

/**
 * The small version of AskAgentBox, for dialogs that create something: one
 * line to describe it instead of filling in the form, which opens the agent
 * at `basePath` with the prompt in its message box (the user still sends it).
 * The dialog's own submit stays the main action, so this button isn't brand.
 * It shares AskAgentBox's look at a compact size: the drifting gradient
 * border, a shimmering label, and a sparkle that wakes up while typing.
 */
export default function AgentHandoff({
  label,
  placeholder,
  basePath,
  toPrompt,
  onHandoff,
}: {
  label: string;
  placeholder: string;
  /** The agent page the prompt opens. */
  basePath: string;
  /** Turns the typed text into the prompt, e.g. by adding what it's about. */
  toPrompt: (text: string) => string;
  /** Called before navigating, e.g. to close the dialog. */
  onHandoff?: () => void;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const typing = text.trim().length > 0;

  return (
    <form
      aria-label={label}
      className="agent-glow flex flex-col gap-1.5 rounded-lg p-2.5"
      onSubmit={(event) => {
        // Dialog forms can sit around this one in the React tree (portals).
        event.preventDefault();
        event.stopPropagation();
        if (!typing) return;
        const prompt = toPrompt(text);
        savePendingPrompt(prompt);
        onHandoff?.();
        router.push(agentPromptHref(prompt, basePath));
      }}
    >
      <p className="flex items-center gap-2 text-xs font-medium">
        <span
          aria-hidden
          data-testid="agent-handoff-mark"
          data-typing={typing || undefined}
          className="agent-mark flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-brand/30 bg-brandSoft"
        >
          <Sparkles className={cn("h-3 w-3 text-brand", typing && "agent-spark")} />
        </span>
        <span className="agent-shimmer">{label}</span>
      </p>
      <div className="flex items-center gap-2">
        <Input
          aria-label="Describe it for the assistant"
          value={text}
          placeholder={placeholder}
          className="h-9 bg-background focus-visible:border-brand/40 focus-visible:ring-brand/10"
          onChange={(event) => setText(event.target.value)}
        />
        <Button
          type="submit"
          size="icon"
          variant="outline"
          aria-label="Open in the assistant"
          title="Open in the assistant"
          disabled={!typing}
          className="h-9 w-9 shrink-0 transition-colors enabled:border-brand/40 enabled:text-brand"
        >
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </form>
  );
}
