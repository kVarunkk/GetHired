"use client";

import Link from "next/link";
import { ArrowRight, CircleCheck, Circle, Eye, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  agentPromptHref,
  ONBOARDING_PROMPT,
  PROFILE_UPDATE_PROMPT,
  savePendingPrompt,
} from "@/helpers/agent/prompt-draft";
import type { ProfileProgress } from "@/helpers/dashboard/summary";
import { PROFILE_VIEW_WINDOW_DAYS } from "@/helpers/outreach/config";

/** Missing items listed before the rest fold into "and N more". */
const SHOWN_MISSING = 3;

/**
 * "N companies viewed your profile" (OR-REQ-021): a count of distinct
 * companies only, never their names (OR-DEC-002). Hidden at 0.
 */
export function ProfileViews({ count }: { count: number }) {
  if (!count || count < 1) return null;
  return (
    <p className="flex items-center gap-2 text-sm text-muted-foreground">
      <Eye className="h-4 w-4 shrink-0" aria-hidden />
      <span>
        <span className="font-semibold text-foreground">{count}</span> {count === 1 ? "company" : "companies"} viewed
        your profile in the last {PROFILE_VIEW_WINDOW_DAYS} days
      </span>
    </p>
  );
}

/**
 * The profile card: before onboarding, a way in; after it, what's still
 * missing for better matches, and how many companies looked.
 */
export default function ProfileChecklist({
  filled,
  progress,
  profileViews,
  lastUpdated,
}: {
  filled: boolean;
  progress: ProfileProgress;
  profileViews: number;
  /** "3 days ago"-style text, or null. */
  lastUpdated: string | null;
}) {
  const prompt = filled ? PROFILE_UPDATE_PROMPT : ONBOARDING_PROMPT;
  const complete = filled && progress.missing.length === 0;
  const extra = progress.missing.length - SHOWN_MISSING;

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            {!filled ? "Finish your profile" : complete ? "Your profile is complete" : "Strengthen your profile"}
          </h2>
          <p className="text-sm text-muted-foreground">
            {!filled
              ? "It takes 2 minutes and unlocks matched jobs and AI features."
              : complete
                ? lastUpdated
                  ? `Last updated ${lastUpdated}. Keep it current for the best matches.`
                  : "Keep it current for the best matches."
                : "A fuller profile gets you better matches."}
          </p>
        </div>

        {filled && !complete && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <Progress value={progress.percent} aria-label="Profile completeness" className="h-2" />
              <span className="shrink-0 text-sm font-medium tabular-nums">{progress.percent}%</span>
            </div>
            <ul className="flex flex-col gap-1.5 text-sm">
              {progress.missing.slice(0, SHOWN_MISSING).map((item) => (
                <li key={item.id} className="flex items-center gap-2">
                  <Circle className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  {item.label}
                </li>
              ))}
              {extra > 0 && <li className="pl-6 text-muted-foreground">and {extra} more</li>}
            </ul>
          </div>
        )}

        {complete && (
          <p className="flex items-center gap-2 text-sm">
            <CircleCheck className="h-4 w-4 shrink-0 text-brand" aria-hidden />
            All {progress.total} essentials done
          </p>
        )}

        <ProfileViews count={profileViews} />

        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm" variant={complete ? "outline" : "brand"}>
            <Link href={agentPromptHref(prompt)} onClick={() => savePendingPrompt(prompt)}>
              <Sparkles className="h-4 w-4" />
              {filled ? "Update with the assistant" : "Complete with the assistant"}
            </Link>
          </Button>
          <Button asChild size="sm" variant="ghost">
            <Link href="/get-started">
              Edit profile
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
