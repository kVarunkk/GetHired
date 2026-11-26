"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CalendarClock,
  ClipboardCheck,
  Clock,
  FileClock,
  FilePen,
  Hourglass,
  Link2,
  MessageSquareReply,
  Mic,
} from "lucide-react";
import toast from "react-hot-toast";
import { markScreeningReviewedAction } from "@/app/actions/interviews/mark-screening-reviewed";
import { remindInterviewersAction } from "@/app/actions/interviews/remind-interviewers";
import { renewSchedulingLinkAction } from "@/app/actions/interviews/send-scheduling-link";
import { moveApplicationsAction } from "@/app/actions/pipeline/move-applications";
import DashboardSection from "@/components/dashboard/DashboardSection";
import MoveDialog, { type MoveOptions, type TemplateOption } from "@/components/pipeline/MoveDialog";
import type { StageOption } from "@/components/pipeline/StagePicker";
import { Button } from "@/components/ui/button";
import { ResponsiveMenu, ResponsiveMenuItem } from "@/components/ui/responsive-menu";
import {
  ATTENTION_KINDS,
  ATTENTION_VIEW_ALL,
  COMPANY_ATTENTION_LIMIT,
  type AttentionKind,
  type CompanyAttentionItem,
} from "@/helpers/company-dashboard/summary";
import type { MoveEmail } from "@/helpers/pipeline/move";
import { changesCandidateStatus } from "@/helpers/pipeline/status-map";
import TrackedLink, { trackDashboardAction } from "./TrackedLink";

const SECTION = "needs_attention";
const FAILED = "Something went wrong. Please try again.";

const ICONS: Record<AttentionKind, typeof Clock> = {
  feedback_overdue: ClipboardCheck,
  screening_to_review: Mic,
  outreach_reply: MessageSquareReply,
  job_pending_approval: FileClock,
  job_closing_soon: CalendarClock,
  waiting_in_applied: Clock,
  awaiting_candidate: Link2,
  stale_draft: FilePen,
};

const actionKey = (label: string) => label.toLowerCase().replace(/\s+/g, "_");

/**
 * "Needs attention" (CD-REQ-016..019): one ranked list, each row with one
 * reason and its next step. Remind panel, Resend link, Mark reviewed and Move
 * run here; the row goes once they work. The rest are links.
 */
export default function CompanyNeedsAttention({
  items,
  stagesByJob = {},
  templates = [],
  openAiInterviews = [],
}: {
  items: CompanyAttentionItem[];
  /** Each job's active stages, for "Move". */
  stagesByJob?: Record<string, StageOption[]>;
  templates?: TemplateOption[];
  /** Applications with an open AI interview invite, which a move to Rejected or Hired cancels. */
  openAiInterviews?: string[];
}) {
  const router = useRouter();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, setPending] = useState<{ item: CompanyAttentionItem; stage: StageOption } | null>(null);

  const visible = items.filter((item) => !hidden.has(item.key));
  const shown = visible.slice(0, COMPANY_ATTENTION_LIMIT);
  const overflow = visible.slice(COMPANY_ATTENTION_LIMIT);
  const overflowKinds = ATTENTION_KINDS.filter((kind) => overflow.some((item) => item.kind === kind));

  const done = (key: string, message: string) => {
    setHidden((prev) => new Set(prev).add(key));
    toast.success(message);
    router.refresh();
  };

  const run = async (key: string, work: () => Promise<void>) => {
    setBusy(key);
    try {
      await work();
    } catch {
      toast.error(FAILED);
    } finally {
      setBusy(null);
    }
  };

  const remind = (item: CompanyAttentionItem, interviewId: string) =>
    run(item.key, async () => {
      const result = await remindInterviewersAction({ interviewId });
      if (!result.ok) {
        toast.error(result.error);
      } else if (result.reminded.length === 0) {
        toast.error(
          result.skipped.some((s) => s.reason === "failed")
            ? "The reminder couldn't be sent. Please try again."
            : "Nobody to remind: each has submitted or was reminded in the last 24 hours.",
        );
      } else {
        done(item.key, `Reminded ${result.reminded.map((m) => m.name).join(", ")}.`);
      }
    });

  const resend = (item: CompanyAttentionItem, interviewId: string, templateId: string) =>
    run(item.key, async () => {
      const result = await renewSchedulingLinkAction({ interviewId, email: { templateId } });
      if (!result.ok) {
        toast.error(result.error);
      } else if (!result.emailed) {
        toast.error(result.warning ?? "The link was renewed, but the email couldn't be sent.");
      } else {
        done(item.key, "Sent a new link.");
      }
    });

  const markReviewed = (item: CompanyAttentionItem, interviewId: string) => {
    trackDashboardAction({ section: SECTION, kind: item.kind, action: "mark_reviewed" });
    return run(item.key, async () => {
      const result = await markScreeningReviewedAction({ id: interviewId });
      if (!result.ok) toast.error(result.error);
      else done(item.key, "Marked as reviewed.");
    });
  };

  const move = (item: CompanyAttentionItem, stage: StageOption, email?: MoveEmail, options?: MoveOptions) => {
    setPending(null);
    const applicationId = item.move!.applicationId;
    return run(item.key, async () => {
      const result = await moveApplicationsAction({
        applicationIds: [applicationId],
        stageId: stage.id,
        ...(email ? { email } : {}),
        ...(options ? { cancelInterviews: options.cancelInterviews } : {}),
      });
      if (!result.ok) {
        toast.error(result.error);
      } else if (result.moved === 0 && result.skipped.some((s) => s.reason === "not_found")) {
        toast.error("Application not found.");
      } else if (result.skipped.some((s) => s.reason === "email_failed")) {
        toast.error(`Moved to ${stage.name}, but the email couldn't be sent.`);
        setHidden((prev) => new Set(prev).add(item.key));
        router.refresh();
      } else {
        const unsent = result.skipped.find((s) => s.reason === "unsubscribed" || s.reason === "no_email");
        done(
          item.key,
          unsent
            ? `Moved to ${stage.name}. Email not sent: ${unsent.reason === "unsubscribed" ? "unsubscribed" : "no email"}.`
            : result.emailed > 0
              ? `Moved to ${stage.name}. Email sends in 2 minutes. Move back to cancel it.`
              : `Moved to ${stage.name}.`,
        );
      }
    });
  };

  const chooseStage = (item: CompanyAttentionItem, stage: StageOption) => {
    trackDashboardAction({ section: SECTION, kind: item.kind, action: "move" });
    // A move the candidate will notice asks first, and can email them.
    if (changesCandidateStatus("applied", stage.kind)) setPending({ item, stage });
    else void move(item, stage);
  };

  const primary = (item: CompanyAttentionItem) => {
    const { action } = item;
    const variant = item.mine ? "brand" : "outline";
    if (action.type === "link") {
      return (
        <Button asChild size="sm" variant={variant}>
          <TrackedLink
            href={action.href}
            track={{ section: SECTION, kind: item.kind, action: actionKey(action.label) }}
          >
            {action.label}
          </TrackedLink>
        </Button>
      );
    }
    return (
      <Button
        size="sm"
        variant="outline"
        disabled={busy !== null}
        onClick={() => {
          trackDashboardAction({ section: SECTION, kind: item.kind, action: action.type });
          if (action.type === "remind") void remind(item, action.interviewId);
          else void resend(item, action.interviewId, action.templateId);
        }}
      >
        {busy === item.key ? "Sending…" : action.label}
      </Button>
    );
  };

  return (
    <DashboardSection title="Needs attention">
      {shown.length === 0 ? (
        <p className="flex items-center gap-2 rounded-xl border border-dashed px-4 py-6 text-sm text-muted-foreground">
          <Hourglass className="h-4 w-4 shrink-0" aria-hidden />
          All caught up
        </p>
      ) : (
        <ul className="divide-y rounded-xl border">
          {shown.map((item) => {
            const Icon = ICONS[item.kind];
            const stages = (item.move && stagesByJob[item.move.jobPostId]) || [];
            const targets = stages.filter((stage) => stage.kind !== "applied");
            return (
              <li
                key={item.key}
                className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <Link href={item.href} className="truncate font-medium underline-offset-4 hover:underline">
                      {item.title}
                    </Link>
                    <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{item.detail}</p>
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {primary(item)}
                  {item.reviewInterviewId && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy !== null}
                      onClick={() => void markReviewed(item, item.reviewInterviewId!)}
                    >
                      {busy === item.key ? "Saving…" : "Mark reviewed"}
                    </Button>
                  )}
                  {targets.length > 0 && (
                    <ResponsiveMenu
                      title={`Move ${item.title}`}
                      trigger={
                        <Button size="sm" variant="ghost" disabled={busy !== null}>
                          {busy === item.key ? "Moving…" : "Move"}
                        </Button>
                      }
                    >
                      {targets.map((stage) => (
                        <ResponsiveMenuItem key={stage.id} onClick={() => chooseStage(item, stage)}>
                          {stage.name}
                        </ResponsiveMenuItem>
                      ))}
                    </ResponsiveMenu>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {overflowKinds.length > 0 && (
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span className="text-muted-foreground">View all:</span>
          {overflowKinds.map((kind) => (
            <Link
              key={kind}
              href={ATTENTION_VIEW_ALL[kind].href}
              className="font-medium underline decoration-muted-foreground/50 underline-offset-4 transition-colors hover:decoration-foreground"
            >
              {ATTENTION_VIEW_ALL[kind].label}
            </Link>
          ))}
        </p>
      )}

      {pending?.item.move && (
        <MoveDialog
          open
          count={1}
          stage={pending.stage}
          changesStatus
          templates={templates}
          previewApplicationId={pending.item.move.applicationId}
          fromKinds={["applied"]}
          openInterviews={openAiInterviews.includes(pending.item.move.applicationId) ? 1 : 0}
          applicationIds={[pending.item.move.applicationId]}
          onConfirm={(email, options) => void move(pending.item, pending.stage, email, options)}
          onCancel={() => setPending(null)}
        />
      )}
    </DashboardSection>
  );
}
