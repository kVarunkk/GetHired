"use client";

import Link from "next/link";
import { Button } from "./ui/button";
import { BriefcaseBusiness, Mail, Sparkles, Timer } from "lucide-react";
import {
  agentPromptHref,
  ONBOARDING_PROMPT,
  savePendingPrompt,
} from "@/helpers/agent/prompt-draft";

export default function ProfileCompletionBanner() {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-6 bg-brandSoft rounded-2xl border border-brand/30 my-10">
      <h2 className="text-2xl sm:text-[28px] font-semibold text-center mb-3 tracking-tight">
        You are missing out on better matches
      </h2>

      <div className="flex items-center flex-wrap justify-center gap-4 text-sm text-muted-foreground text-center mb-8 max-w-2xl">
        <div className="flex items-center gap-1.5">
          <BriefcaseBusiness className="shrink-0 h-4 w-4" />
          <p>Jobs tailored for you</p>
        </div>
        <div className="flex items-center gap-1.5">
          <Mail className="shrink-0 h-4 w-4" />
          <p>Daily Job Digest</p>
        </div>
        <div className="flex items-center gap-1.5">
          <Timer className="shrink-0 h-4 w-4" />
          <p>2 min to complete</p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row items-center gap-6">
        <Button asChild size="lg" variant="brand" className="w-full sm:w-auto px-8">
          {/* Saved too, so the prompt survives a detour through login. */}
          <Link
            href={agentPromptHref(ONBOARDING_PROMPT)}
            onClick={() => savePendingPrompt(ONBOARDING_PROMPT)}
          >
            <Sparkles className="h-4 w-4" />
            Complete Profile with the Agent
          </Link>
        </Button>
      </div>
    </div>
  );
}
