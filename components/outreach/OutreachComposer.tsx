"use client";

import { useEffect, useState } from "react";
import { AlertCircle, Loader2, Sparkles } from "lucide-react";
import toast from "react-hot-toast";
import { loadOutreachComposerAction, type ComposerContext } from "@/app/actions/outreach/load-composer";
import { sendOutreachAction } from "@/app/actions/outreach/send-outreach";
import { draftOutreachAction } from "@/app/actions/outreach/draft-outreach";
import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { OUTREACH_MESSAGE_MAX, OUTREACH_SUBJECT_MAX } from "@/helpers/outreach/config";
import { renderOutreachTemplate } from "@/helpers/outreach/template";
import { useEntitlementError } from "@/hooks/useEntitlementError";
import type { CandidateOutreach } from "@/utils/types/outreach.types";

const NO_JOB = "none";

function planQuotaLabel(quota: ComposerContext["quota"]) {
  if (!quota) return null;
  if (quota.remaining === null) return "Unlimited outreach on your plan";
  return `${quota.remaining} of ${quota.amount ?? quota.remaining} left this month`;
}

/** The plan's quota, plus the member's own cap from their role (RP-REQ-044). */
function quotaLabel(quota: ComposerContext["quota"], cap: ComposerContext["memberCap"]) {
  const parts = [planQuotaLabel(quota), cap && `${cap.remaining} of your ${cap.limit} left`].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

/**
 * "Reach out" (OR-TASK-003): a message to a talent-pool candidate, with an
 * optional job, a `custom` template, an AI draft and this month's quota.
 * Contact details are never shown here; the candidate answers on GetHired.
 */
export default function OutreachComposer({
  candidateId,
  candidateName,
  open,
  onOpenChange,
  onSent,
  defaultJobPostId,
}: {
  candidateId: string;
  candidateName?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSent?: (outreach: CandidateOutreach) => void;
  defaultJobPostId?: string | null;
}) {
  const [ctx, setCtx] = useState<ComposerContext | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [jobPostId, setJobPostId] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const { handle, dialog } = useEntitlementError();

  useEffect(() => {
    if (!open || ctx) return;
    let cancelled = false;
    void loadOutreachComposerAction({ candidateId }).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setLoadError(result.error);
        return;
      }
      setCtx(result);
      if (defaultJobPostId && result.jobs.some((j) => j.id === defaultJobPostId)) {
        setJobPostId(defaultJobPostId);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open, ctx, candidateId, defaultJobPostId]);

  const name = ctx?.candidateFirstName ?? candidateName ?? "this candidate";
  const blocked = ctx !== null && !ctx.acceptsOutreach;
  const busy = sending || drafting;
  const subjectTooLong = subject.trim().length > OUTREACH_SUBJECT_MAX;
  const messageTooLong = message.trim().length > OUTREACH_MESSAGE_MAX;
  const canSend =
    ctx !== null &&
    !blocked &&
    !busy &&
    subject.trim().length > 0 &&
    message.trim().length > 0 &&
    !subjectTooLong &&
    !messageTooLong;

  const applyTemplate = (templateId: string) => {
    const template = ctx?.templates.find((t) => t.id === templateId);
    if (!template || !ctx) return;
    const jobTitle = ctx.jobs.find((j) => j.id === jobPostId)?.title ?? null;
    const result = renderOutreachTemplate(template, {
      candidate_first_name: ctx.candidateFirstName,
      job_title: jobTitle,
      company_name: ctx.companyName,
      scheduling_link: ctx.schedulingLink,
      sender_name: ctx.senderName,
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSubject(result.subject.slice(0, OUTREACH_SUBJECT_MAX));
    setMessage(result.message);
    setError(null);
    setNotice(
      result.missing.includes("scheduling_link")
        ? "{{scheduling_link}} was left in the message: add a scheduling link in Settings."
        : result.missing.length > 0
          ? `Fill in ${result.missing.map((v) => `{{${v}}}`).join(", ")} before sending.`
          : null,
    );
  };

  const draft = async () => {
    setDrafting(true);
    setError(null);
    try {
      const result = await draftOutreachAction({ candidateId, jobPostId: jobPostId || null });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setMessage(result.message);
      if (!subject.trim() && result.subject) setSubject(result.subject);
    } finally {
      setDrafting(false);
    }
  };

  const send = async () => {
    setSending(true);
    setError(null);
    try {
      const result = await sendOutreachAction({
        candidateId,
        jobPostId: jobPostId || null,
        subject: subject.trim(),
        message: message.trim(),
      });
      if (await handle(result)) return;
      if (!result.ok) {
        setError(typeof result.error === "string" ? result.error : "Couldn't send the message.");
        return;
      }
      toast.success(
        result.emailed
          ? `Message sent to ${name}.`
          : `Message sent. ${name} will see it on GetHired (the email didn't go through).`,
      );
      onSent?.(result.outreach);
      setSubject("");
      setMessage("");
      setNotice(null);
      setCtx(null);
      onOpenChange(false);
    } finally {
      setSending(false);
    }
  };

  const quota = quotaLabel(ctx?.quota ?? null, ctx?.memberCap ?? null);

  return (
    <>
      <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
        <ResponsiveDialogContent className="sm:max-w-lg">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>Reach out to {name}</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              They answer on GetHired. Contact details are shared when they say they&apos;re interested.
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>

          <ResponsiveDialogBody>
            {loadError ? (
              <p role="alert" className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                <AlertCircle className="h-4 w-4" />
                {loadError}
              </p>
            ) : !ctx ? (
              <div className="flex flex-col gap-3" aria-label="Loading">
                <div className="h-9 animate-pulse rounded-lg bg-muted" />
                <div className="h-9 animate-pulse rounded-lg bg-muted" />
                <div className="h-32 animate-pulse rounded-lg bg-muted" />
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {blocked && (
                  <p className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
                    {name} isn&apos;t accepting outreach right now.
                  </p>
                )}

                <div className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-muted-foreground">Job (optional)</span>
                  <Select
                    value={jobPostId || NO_JOB}
                    disabled={blocked || busy}
                    onValueChange={(value) => setJobPostId(value === NO_JOB ? "" : value)}
                  >
                    <SelectTrigger aria-label="Job">
                      <SelectValue placeholder="No job" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_JOB}>No job</SelectItem>
                      {ctx.jobs.map((job) => (
                        <SelectItem key={job.id} value={job.id}>
                          {job.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {ctx.templates.length > 0 && (
                  <div className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-muted-foreground">Template</span>
                    <Select value="" disabled={blocked || busy} onValueChange={applyTemplate}>
                      <SelectTrigger aria-label="Template">
                        <SelectValue placeholder="Use a template…" />
                      </SelectTrigger>
                      <SelectContent>
                        {ctx.templates.map((t) => (
                          <SelectItem key={t.id} value={t.id}>
                            {t.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <label className="flex flex-col gap-1">
                  <span className="flex justify-between text-xs font-medium text-muted-foreground">
                    Subject
                    <span aria-label="Subject length">
                      {subject.trim().length}/{OUTREACH_SUBJECT_MAX}
                    </span>
                  </span>
                  <Input
                    aria-label="Subject"
                    value={subject}
                    disabled={blocked || busy}
                    aria-invalid={subjectTooLong || undefined}
                    onChange={(e) => setSubject(e.target.value)}
                  />
                </label>

                <label className="flex flex-col gap-1">
                  <span className="flex justify-between text-xs font-medium text-muted-foreground">
                    Message
                    <span aria-label="Message length">
                      {message.trim().length}/{OUTREACH_MESSAGE_MAX}
                    </span>
                  </span>
                  <Textarea
                    aria-label="Message"
                    rows={8}
                    value={message}
                    disabled={blocked || busy}
                    aria-invalid={messageTooLong || undefined}
                    onChange={(e) => setMessage(e.target.value)}
                  />
                </label>

                {notice && <p className="text-xs text-warning">{notice}</p>}
                {error && (
                  <p role="alert" className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-sm text-destructive">
                    <AlertCircle className="h-4 w-4" />
                    {error}
                  </p>
                )}
              </div>
            )}
          </ResponsiveDialogBody>

          <ResponsiveDialogFooter className="items-center gap-2 sm:justify-between">
            <span className="text-xs text-muted-foreground">{quota}</span>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={!ctx || blocked || busy}
                onClick={() => void draft()}
              >
                {drafting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-label="Drafting" />
                ) : (
                  <Sparkles className="mr-2 h-4 w-4" />
                )}
                Draft with AI
              </Button>
              <Button type="button" variant="brand" disabled={!canSend} onClick={() => void send()}>
                {sending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Send
              </Button>
            </div>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
      {dialog}
    </>
  );
}
