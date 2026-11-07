import Link from "next/link";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { agentPromptHref } from "@/helpers/agent/prompt-draft";

/** Improve with AI (RI-REQ-063): opens the agent with this prompt in its message box. */
export default function ImproveResumeLink({ prompt }: { prompt: string }) {
  return (
    <Button asChild variant="outline" size="sm">
      <Link href={agentPromptHref(prompt)}>
        <Sparkles className="h-4 w-4" aria-hidden />
        Improve with AI
      </Link>
    </Button>
  );
}
