"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BellRing, Clock, MessageSquareReply } from "lucide-react";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { setTrackedStatusAction } from "@/app/actions/tracker/set-tracked-status";
import { agentPromptHref, savePendingPrompt } from "@/helpers/agent/prompt-draft";
import type { AttentionItem, AttentionReason } from "@/helpers/dashboard/summary";
import { followUpPrompt } from "@/helpers/tracker/agent-prompts";
import { daysSince, shortDate } from "@/helpers/tracker/card";
import { myJobsPath, trackedApplicationPath } from "@/helpers/tracker/paths";
import DashboardSection from "./DashboardSection";

/** Rows shown before "View all" takes over. */
export const ATTENTION_LIMIT = 6;

function reasonText(reason: AttentionReason): string {
  switch (reason.kind) {
    case "follow_up":
      return reason.overdue ? `Follow-up was due ${shortDate(reason.due)}` : "Follow-up due today";
    case "no_reply":
      return `No reply in ${reason.days} days`;
    case "update": {
      const days = daysSince(reason.changedAt);
      return `${reason.label} · updated ${days === 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`}`;
    }
  }
}

const ICONS = { follow_up: BellRing, no_reply: Clock, update: MessageSquareReply } as const;

/**
 * "Needs your attention" (dashboard): follow-ups due, tracked applications
 * with no reply in 30 days, and GetHired applications a company just moved.
 * Each row has the one thing to do next.
 */
export default function NeedsAttention({ items }: { items: AttentionItem[] }) {
  const router = useRouter();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);

  const visible = items.filter(({ item }) => !hidden.has(item.id));
  const shown = visible.slice(0, ATTENTION_LIMIT);

  const markGhosted = async (id: string) => {
    setBusy(id);
    try {
      const result = await setTrackedStatusAction({ id, status: "ghosted" });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setHidden((prev) => new Set(prev).add(id));
      toast.success("Marked as ghosted");
      router.refresh();
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <DashboardSection
      title="Needs your attention"
      action={visible.length > ATTENTION_LIMIT ? { label: `View all (${visible.length})`, href: myJobsPath() } : undefined}
    >
      {shown.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-6 text-sm text-muted-foreground">
          Nothing needs you right now. Follow-ups you set in{" "}
          <Link className="font-medium text-foreground underline decoration-muted-foreground/50 underline-offset-4 transition-colors hover:decoration-foreground" href={myJobsPath()}>
            My Jobs
          </Link>{" "}
          and replies from companies show up here.
        </p>
      ) : (
        <ul className="divide-y rounded-xl border">
          {shown.map(({ item, reason }) => {
            const Icon = ICONS[reason.kind];
            const prompt = followUpPrompt(item);
            return (
              <li
                key={`${item.kind}:${item.id}`}
                className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <Link
                      href={trackedApplicationPath(item.id)}
                      className="truncate font-medium underline-offset-4 hover:underline"
                    >
                      {item.jobTitle}
                    </Link>
                    <p className="text-sm text-muted-foreground">
                      {item.companyName} · {reasonText(reason)}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {reason.kind === "update" ? (
                    <Button asChild size="sm" variant="outline">
                      <Link href={trackedApplicationPath(item.id)}>View</Link>
                    </Button>
                  ) : (
                    <Button asChild size="sm" variant="outline">
                      <Link href={agentPromptHref(prompt)} onClick={() => savePendingPrompt(prompt)}>
                        Draft follow-up
                      </Link>
                    </Button>
                  )}
                  {reason.kind === "no_reply" && (
                    <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => markGhosted(item.id)}>
                      {busy === item.id ? "Saving…" : "Mark as ghosted"}
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </DashboardSection>
  );
}
