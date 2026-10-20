"use client";

import Link from "next/link";
import { Mic } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ScreeningInviteSummary } from "@/helpers/interview/screening/my-interviews";

const formatDeadline = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/** The apply form's success state when the company invited the applicant to an AI interview (SIT-050). */
export default function ScreeningInviteCard({
  interview,
  onLater,
}: {
  interview: ScreeningInviteSummary;
  onLater: () => void;
}) {
  return (
    <div className="p-4 sm:p-6 space-y-4 animate-in fade-in duration-300">
      <div className="space-y-1">
        <p className="text-sm text-muted-foreground">Application sent.</p>
        <h3 className="text-lg font-semibold tracking-tight">You&apos;re invited to an AI interview</h3>
      </div>
      <div className="rounded-xl border border-border p-4 space-y-3">
        <div className="flex items-start gap-3">
          <Mic className="h-5 w-5 mt-0.5 text-muted-foreground shrink-0" />
          <div className="space-y-1 text-sm">
            <p>
              A {interview.durationMinutes}-minute voice conversation. The company reads the transcript and makes
              the decision.
            </p>
            <p className="text-muted-foreground">Complete it by {formatDeadline(interview.deadlineAt)}.</p>
          </div>
        </div>
        <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
          <Button type="button" variant="ghost" onClick={onLater}>
            Do it later
          </Button>
          <Button variant="brand" asChild>
            <Link href={`/interview/screening/${interview.id}`}>Start now</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
