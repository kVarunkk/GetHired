"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Clock, Loader2, Mic } from "lucide-react";
import toast from "react-hot-toast";
import PageHeader from "@/components/PageHeader";
import ConfirmDialog from "@/components/ConfirmDialog";
import InterviewComponent from "@/components/InterviewComponent";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { recordScreeningConsentAction } from "@/app/actions/interviews/record-screening-consent";
import { declineScreeningInterviewAction } from "@/app/actions/interviews/decline-screening-interview";
import { requestScreeningAccommodationAction } from "@/app/actions/interviews/request-screening-accommodation";
import { getMyScreeningInterviewAction } from "@/app/actions/interviews/get-my-screening-interview";
import { SCREENING_CONSENT_VERSION, screeningConsentText } from "@/helpers/interview/screening/schemas";
import type { MyScreeningInterview } from "@/helpers/interview/screening/my-interviews";
import type { TInterviewServer } from "@/utils/types/interview.types";

type SessionSummary = { id: string; started_at: string; status: string; analysisStatus: string | null };

const ACCOMMODATION_MAX_CHARS = 500;
const POLL_MS = 3000;
const POLL_TRIES = 40;

const formatDeadline = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/** What the closed states say (SIT-053). */
const CLOSED_COPY: Record<string, { title: string; body: (company: string) => string }> = {
  expired: { title: "This interview has expired", body: () => "The deadline passed before the interview was taken." },
  declined: {
    title: "You declined this interview",
    body: (company) => `Your application is still with ${company}.`,
  },
  cancelled: {
    title: "This interview was cancelled",
    body: (company) => `${company} cancelled the interview. Your application is still with them.`,
  },
  withdrawn: { title: "This interview is closed", body: () => "The application was withdrawn." },
};

/**
 * The candidate's screening interview page (SI-REQ-020/025/026): the intro,
 * notice and consent, a microphone check, decline and "alternative format",
 * then the interview itself. Never shows questions, descriptions or scores.
 */
export default function ScreeningInterviewView({
  invite,
  interview,
  sessionHistory,
}: {
  invite: MyScreeningInterview;
  interview: TInterviewServer | null;
  sessionHistory: SessionSummary[];
}) {
  const router = useRouter();
  const [live, setLive] = useState(invite);
  const [consented, setConsented] = useState(
    !!invite.consented_at && invite.consent_version === SCREENING_CONSENT_VERSION,
  );
  const [consentBusy, setConsentBusy] = useState(false);
  const [mic, setMic] = useState<"unchecked" | "checking" | "ok" | "failed">("unchecked");
  const [entered, setEntered] = useState(false);
  const [checking, setChecking] = useState(invite.status === "in_progress");
  const [declineOpen, setDeclineOpen] = useState(false);
  const [accommodationOpen, setAccommodationOpen] = useState(false);

  useEffect(() => setLive(invite), [invite]);

  // After an attempt the voice server reports the transcript; read the
  // status until it leaves in_progress.
  useEffect(() => {
    if (!checking) return;
    let cancelled = false;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const result = await getMyScreeningInterviewAction({ id: invite.id }).catch(() => null);
      if (cancelled) return;
      tries += 1;
      const done = result?.ok && result.interview.status !== "in_progress";
      if (result?.ok) setLive(result.interview);
      if (done || tries >= POLL_TRIES) setChecking(false);
      else timer = setTimeout(tick, POLL_MS);
    };
    timer = setTimeout(tick, POLL_MS / 2);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [checking, invite.id]);

  const onEnded = useCallback(() => setChecking(true), []);

  const company = live.company_name;
  const closed = CLOSED_COPY[live.status];
  if (closed) {
    return (
      <StatusPage invite={live} icon={<Clock className="h-5 w-5 text-muted-foreground" />} title={closed.title}>
        {closed.body(company)}
      </StatusPage>
    );
  }
  if (live.status === "paused") {
    return (
      <StatusPage
        invite={live}
        icon={<Clock className="h-5 w-5 text-muted-foreground" />}
        title="Request sent"
      >
        {company} has your request for an alternative format. The deadline is paused until they reply by email.
      </StatusPage>
    );
  }

  const showInterview =
    !!interview && (entered || live.status !== "invited" || live.attempts_used > 0 || checking);
  if (showInterview) {
    return (
      <InterviewComponent
        interviewId={interview.id}
        interview={interview}
        sessionHistory={sessionHistory}
        screening={{
          applicationInterviewId: live.id,
          companyName: company,
          jobTitle: live.job_title,
          durationMinutes: live.duration_minutes,
          status: live.status,
          attemptsUsed: live.attempts_used,
          maxAttempts: live.max_attempts,
          checking,
          onEnded,
        }}
      />
    );
  }

  const attemptsLeft = live.max_attempts - live.attempts_used;

  async function consent(checked: boolean) {
    if (!checked || consented) return;
    setConsentBusy(true);
    const result = await recordScreeningConsentAction({ id: live.id });
    setConsentBusy(false);
    if (result.ok) setConsented(true);
    else toast.error(result.error);
  }

  async function checkMic() {
    setMic("checking");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      setMic("ok");
    } catch {
      setMic("failed");
    }
  }

  async function decline() {
    const result = await declineScreeningInterviewAction({ id: live.id });
    if (!result.ok) {
      toast.error(result.error);
      return false;
    }
    setLive({ ...live, status: "declined" });
    router.refresh();
  }

  return (
    <div className="flex flex-col w-full gap-6 p-4 mb-20">
      <PageHeader
        title="AI interview"
        description={`${live.job_title} at ${company}`}
        backHref="/dashboard"
        backLabel="Back to dashboard"
      />

      <section className="max-w-3xl rounded-xl border border-border p-4 sm:p-5 space-y-4">
        <dl className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">Length</dt>
            <dd className="font-medium">{live.duration_minutes} minutes</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Complete by</dt>
            <dd className="font-medium">{formatDeadline(live.deadline_at)}</dd>
          </div>
        </dl>
        {live.competency_names.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">What {company} wants to learn about</p>
            <div className="flex flex-wrap gap-2">
              {live.competency_names.map((name) => (
                <Badge key={name} variant="secondary">
                  {name}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="max-w-3xl space-y-3 text-sm">
        <p>
          You&apos;ll talk to an AI interviewer. The conversation is transcribed and shared with {company}, who
          makes the decision. Audio isn&apos;t stored.
        </p>
        <p className="text-muted-foreground">
          When the interviewer wraps up, your interview is submitted and can&apos;t be retaken. If your connection
          drops, you can try again
          {attemptsLeft > 1 ? ` (${attemptsLeft} attempts in total)` : ""}. Find a quiet place; a phone works fine.
        </p>
      </section>

      <section className="max-w-3xl rounded-xl border border-border p-4 sm:p-5 space-y-4">
        <div className="flex items-start gap-3">
          <Checkbox
            id="screening-consent"
            checked={consented}
            disabled={consented || consentBusy}
            onCheckedChange={(value) => void consent(value === true)}
            className="mt-0.5"
          />
          <Label htmlFor="screening-consent" className="text-sm font-normal leading-relaxed">
            {screeningConsentText(company)}
          </Label>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            disabled={!consented || mic === "checking"}
            onClick={() => void checkMic()}
          >
            {mic === "checking" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mic className="mr-2 h-4 w-4" />}
            Check microphone
          </Button>
          {mic === "ok" && (
            <span className="flex items-center gap-1.5 text-sm text-success">
              <CheckCircle2 className="h-4 w-4" /> Microphone works
            </span>
          )}
          {mic === "failed" && (
            <span className="text-sm text-destructive">
              We couldn&apos;t use your microphone. Allow access in your browser settings and try again.
            </span>
          )}
        </div>
      </section>

      <div className="flex max-w-3xl flex-col-reverse sm:flex-row sm:items-center gap-3 sm:justify-between">
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="ghost" onClick={() => setAccommodationOpen(true)}>
            Request an alternative format
          </Button>
          <Button type="button" variant="destructive-ghost" onClick={() => setDeclineOpen(true)}>
            Decline
          </Button>
        </div>
        <Button
          type="button"
          variant="brand"
          disabled={!consented || mic !== "ok" || !interview}
          onClick={() => setEntered(true)}
        >
          Continue to interview
        </Button>
      </div>

      <ConfirmDialog
        open={declineOpen}
        onOpenChange={setDeclineOpen}
        title="Decline the interview?"
        description={`${company} will be told. Your application stays with them, but you can't take this interview later.`}
        confirmLabel="Decline"
        onConfirm={decline}
      />
      <AccommodationDialog
        open={accommodationOpen}
        onOpenChange={setAccommodationOpen}
        company={company}
        onSent={() => {
          setLive({ ...live, status: "paused" });
          router.refresh();
        }}
        id={live.id}
      />
    </div>
  );
}

function StatusPage({
  invite,
  icon,
  title,
  children,
}: {
  invite: MyScreeningInterview;
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col w-full gap-6 p-4 mb-20">
      <PageHeader
        title="AI interview"
        description={`${invite.job_title} at ${invite.company_name}`}
        backHref="/dashboard"
        backLabel="Back to dashboard"
      />
      <div className="max-w-3xl rounded-xl border border-border p-4 sm:p-5 flex items-start gap-3">
        {icon}
        <div className="space-y-1">
          <h2 className="font-semibold">{title}</h2>
          <p className="text-sm text-muted-foreground">{children}</p>
        </div>
      </div>
    </div>
  );
}

function AccommodationDialog({
  open,
  onOpenChange,
  company,
  id,
  onSent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  company: string;
  id: string;
  onSent: () => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const trimmed = text.trim();

  async function send() {
    setBusy(true);
    const result = await requestScreeningAccommodationAction({ id, text: trimmed });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    onOpenChange(false);
    onSent();
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Request an alternative format</DialogTitle>
          <DialogDescription>
            Tell {company} what would work better for you, for example a hearing impairment, a speech difference
            or no quiet place to talk. The deadline pauses until they reply.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label htmlFor="accommodation-text" className="sr-only">
            Your request
          </Label>
          <Textarea
            id="accommodation-text"
            value={text}
            maxLength={ACCOMMODATION_MAX_CHARS}
            rows={5}
            onChange={(e) => setText(e.target.value)}
            disabled={busy}
          />
          <p className="text-xs text-muted-foreground text-right">
            {text.length}/{ACCOMMODATION_MAX_CHARS}
          </p>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" variant="brand" onClick={() => void send()} disabled={busy || !trimmed}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Send request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
