"use client";

import { useVoiceAgent } from "@/hooks/useVoiceAgent";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  PhoneOff,
  Play,
  Loader2,
  Volume2,
  User,
  Bot,
  Radio,
  ChevronDown,
  FileUser,
  Briefcase,
  CheckCircle2,
  ListChecks,
  Search,
} from "lucide-react";
import { BackLink } from "./PageHeader";
import { TInterviewServer } from "@/utils/types/interview.types";
import Link from "next/link";
import { Button } from "./ui/button";
import toast from "react-hot-toast";
import ModifiedLink from "./ModifiedLink";

/** A company's screening interview (SI-REQ-025): the server decides what happens after each attempt. */
type ScreeningProps = {
  applicationInterviewId: string;
  companyName: string;
  jobTitle: string;
  durationMinutes: number;
  /** application_interviews.status, as the page last read it. */
  status: string;
  attemptsUsed: number;
  maxAttempts: number;
  /** The page is reading the status again after an attempt ended. */
  checking?: boolean;
  /** Called when an attempt ends here, so the page can read what the server made of it. */
  onEnded?: () => void;
};

interface InterviewComponentProps {
  interviewId: string;
  interview: TInterviewServer;
  sessionHistory: {
    id: string;
    started_at: string;
    status: string;
    analysisStatus: string | null;
  }[];
  screening?: ScreeningProps;
}

const PRACTICE_SECONDS = 5 * 60;

export default function InterviewComponent({
  interviewId,
  interview,
  sessionHistory,
  screening,
}: InterviewComponentProps) {
  const voiceArgs: Parameters<typeof useVoiceAgent> = screening
    ? [interviewId, { mode: "screening", applicationInterviewId: screening.applicationInterviewId }]
    : [interviewId];
  const { status, errorMessage, lines, analysisSession, start, stop } =
    useVoiceAgent(...voiceArgs);
  const [autoScroll, setAutoScroll] = useState(true);
  const totalSeconds = screening ? screening.durationMinutes * 60 : PRACTICE_SECONDS;
  const [timeLeft, setTimeLeft] = useState(totalSeconds);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const isActive = status === "connecting" || status === "live";

  // Screening states. The voice server reports the transcript, so an ended
  // attempt is "saving" until the page reads a new status.
  const submitted = screening?.status === "completed";
  const saving =
    !!screening && !submitted && !isActive && (!!screening.checking || screening.status === "in_progress");
  const attemptsLeft = screening ? screening.maxAttempts - screening.attemptsUsed : 0;
  const interrupted =
    !!screening && screening.status === "invited" && screening.attemptsUsed > 0 && status !== "error";
  const retryable =
    !!screening && screening.status === "invited" && (status === "error" || status === "stopped" || interrupted);

  const onEnded = screening?.onEnded;
  const wasActiveRef = useRef(false);
  useEffect(() => {
    if (isActive) wasActiveRef.current = true;
    else if (wasActiveRef.current) {
      wasActiveRef.current = false;
      onEnded?.();
    }
  }, [isActive, onEnded]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
      .toString()
      .padStart(2, "0");
    const secs = (seconds % 60).toString().padStart(2, "0");
    return `${mins}:${secs}`;
  };

  const historyLines: {
    id: string;
    role: "user" | "assistant";
    text: string;
    turn_id: string;
  }[] = useMemo(() => {
    const latestSession = [...sessionHistory]
      .sort(
        (a, b) =>
          new Date(a.started_at).getTime() - new Date(b.started_at).getTime(),
      )
      .at(-1);
    const savedTurns = latestSession
      ? interview.interview_sessions?.find(
          (session) => session.id === latestSession.id,
        )?.turns
      : interview.turns;
    const turns = (savedTurns ?? []) as {
      user?: string;
      assistant?: string;
      turn_id?: string;
      interrupted?: boolean;
    }[];

    return turns
      .flatMap((turn, index) => {
        const turnId = turn.turn_id ?? `turn-${index}`;
        const sessionPrefix = latestSession?.id ?? "legacy";
        return [
          turn.user
            ? {
                id: `h-user-${sessionPrefix}-${turnId}-${index}`,
                role: "user" as const,
                text: turn.user,
                turn_id: turnId,
              }
            : null,
          turn.assistant
            ? {
                id: `h-assistant-${sessionPrefix}-${turnId}-${index}`,
                role: "assistant" as const,
                text: turn.assistant,
                turn_id: turnId,
                interrupted: turn.interrupted,
              }
            : null,
        ];
      })
      .filter((line): line is NonNullable<typeof line> => line !== null);
  }, [interview?.turns, interview.interview_sessions, sessionHistory]);

  // SI-DEC-003: candidates never see a screening analysis.
  const latestAnalysisSessionId = screening
    ? undefined
    : (analysisSession?.sessionId ??
      [...sessionHistory]
        .reverse()
        .find((session) => session.analysisStatus !== null)?.id);

  // Auto scroll transcript to bottom as new messages arrive
  useEffect(() => {
    if (autoScroll) {
      endRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [lines, autoScroll]);

  useEffect(() => {
    if (status === "idle" || status === "stopped" || status === "error") {
      setTimeLeft(totalSeconds);
    }

    if (status !== "live") {
      return;
    }

    const timer = window.setInterval(() => {
      setTimeLeft((prev) => Math.max(0, prev - 1));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [status, totalSeconds]);

  useEffect(() => {
    if (errorMessage) {
      toast.error(errorMessage);
    } else if (status === "error") {
      toast.error(
        "Failed to connect. Please check mic permissions and try again.",
      );
    }
  }, [errorMessage, status]);

  // Handle user scrolling up manually to disable auto-scroll
  const handleScroll = () => {
    if (!scrollContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } =
      scrollContainerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    setAutoScroll(isAtBottom);
  };

  return (
    <div className="flex flex-col h-dvh max-h-dvh bg-background text-foreground overflow-hidden">
      {/* Top Header Bar */}
      <header className="flex-none border-b border-border bg-card px-4 py-3 sm:px-6 flex items-center justify-between gap-3 z-10">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <BackLink
            href={screening ? "/dashboard" : "/interview"}
            label={screening ? "Back to dashboard" : "Back to interviews"}
          />
          {screening ? (
            <div className="min-w-0 flex-1">
              <h1 className="text-base sm:text-lg font-semibold tracking-tight leading-tight truncate">
                AI interview: {screening.jobTitle}
              </h1>
              <p className="mt-0.5 text-xs text-muted-foreground truncate">{screening.companyName}</p>
            </div>
          ) : (
          <div className="min-w-0 flex-1">
            <h1
              className="text-base sm:text-lg font-semibold tracking-tight leading-tight truncate"
              title={interview.name || "AI Interview"}
            >
              {interview.name || "AI Interview"}
            </h1>
            <div className="mt-0.5 flex items-center flex-wrap gap-x-3 gap-y-0.5 min-w-0">
              {interview.all_jobs?.job_name && (
                <Link
                  className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 min-w-0 max-w-full"
                  href={"/jobs/" + interview.job_id}
                  target="_blank"
                  title={interview.all_jobs.job_name}
                >
                  <Briefcase size={14} className="shrink-0" />
                  <span className="truncate underline underline-offset-4">
                    {interview.all_jobs.job_name}
                  </span>
                </Link>
              )}
              {interview.resumes?.name && (
                <Link
                  className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 min-w-0 max-w-full"
                  href={"/resume/" + interview.resume_id}
                  target="_blank"
                  title={interview.resumes.name}
                >
                  <FileUser size={14} className="shrink-0" />
                  <span className="truncate underline underline-offset-4">
                    {interview.resumes.name}
                  </span>
                </Link>
              )}
            </div>
          </div>
          )}
        </div>

        {/* Status Badge */}
        <div className="flex items-center gap-2 shrink-0">
          {latestAnalysisSessionId && (
            <ModifiedLink
              href={`/interview/${interviewId}/analysis/${latestAnalysisSessionId}`}
            >
              <Button size="sm">Analysis</Button>
            </ModifiedLink>
          )}
          {/* <StatusBadge status={status} /> */}
        </div>
      </header>

      {/* Main Container - Split View for Desktop / Stacked for Mobile */}
      <main className="flex-1 min-h-0 flex flex-col md:grid md:grid-cols-12 overflow-hidden bg-background">
        {/* Left Column: AI Stage & Visualizer */}
        <section className="flex-none max-h-[45%] md:max-h-none md:h-full md:col-span-5 flex flex-col min-h-0 bg-secondary/30 border-b md:border-b-0 md:border-r border-border relative overflow-hidden">
          {/* Decorative ambient background blur */}
          <div className="absolute -top-24 -left-24 w-72 h-72 bg-brand/10 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-24 -right-24 w-72 h-72 bg-brandSoft rounded-full blur-3xl pointer-events-none" />

          {/* Scrolls on short screens (or when zoomed in) instead of clipping */}
          <div className="relative z-10 flex-1 min-h-0 overflow-y-auto flex flex-col justify-between items-center gap-4 p-4 sm:p-6">
            {/* Top Info Tag */}
            <div className="w-full flex flex-wrap justify-between items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5 font-medium">
                <Radio
                  className={`w-3.5 h-3.5 shrink-0 ${status === "live" ? "text-success animate-pulse" : ""}`}
                />
                {status === "live" ? "Voice Session Active" : submitted ? "Interview submitted" : "Session Offline"}
              </span>
              <span>16 kHz / Mono PCM</span>
            </div>

            {/* Center Stage: AI Avatar & Audio Visualizer */}
            <div className="my-auto w-full flex flex-col items-center justify-center text-center py-2 sm:py-8">
              <div className="relative flex items-center justify-center">
                {/* Pulsing Aura when AI is speaking / live */}
                {status === "live" && (
                  <>
                    <div className="absolute w-32 h-32 sm:w-56 sm:h-56 rounded-full bg-brand/15 animate-ping opacity-75" />
                    <div className="absolute w-28 h-28 sm:w-48 sm:h-48 rounded-full bg-brand/25 animate-pulse" />
                  </>
                )}

                {/* Connecting Spinner Background */}
                {status === "connecting" && (
                  <div className="absolute w-28 h-28 sm:w-48 sm:h-48 rounded-full border-2 border-dashed border-brand animate-spin" />
                )}

                {/* Central Avatar Box */}
                <div
                  className={`relative w-20 h-20 sm:w-36 sm:h-36 rounded-full flex items-center justify-center transition-all duration-300 border-2 ${
                    screening && submitted
                      ? "bg-success/10 text-success border-success/30"
                      : status === "live"
                      ? "bg-brand text-brand-foreground border-white/20 scale-105"
                      : status === "connecting"
                        ? "bg-card text-brand border-brand"
                        : "bg-muted text-muted-foreground border-border"
                  }`}
                >
                  {screening && submitted ? (
                    <CheckCircle2 className="w-10 h-10 sm:w-16 sm:h-16" />
                  ) : status === "connecting" ? (
                    <Loader2 className="w-10 h-10 sm:w-16 sm:h-16 animate-spin text-brand" />
                  ) : (
                    <Bot className="w-10 h-10 sm:w-16 sm:h-16" />
                  )}
                </div>
              </div>

              {/* AI Status Text */}
              {screening && submitted ? (
                <StageText
                  title="Interview submitted"
                  body={`You're all done. ${screening.companyName} will review your interview, and any update shows on your application.`}
                />
              ) : screening && saving ? (
                <StageText title="Saving your interview…" body="This takes a few seconds. You can stay on this page." />
              ) : screening && interrupted && !isActive ? (
                <StageText
                  title="Interview interrupted"
                  body={
                    attemptsLeft === 1
                      ? "Your connection dropped. You have one more attempt."
                      : `Your connection dropped. You have ${attemptsLeft} more attempts.`
                  }
                />
              ) : (
              <>
              <h2 className="mt-4 sm:mt-6 text-lg sm:text-2xl font-semibold tracking-tight text-balance">
                {status === "idle" && "Ready to start interview"}
                {status === "connecting" && "Establishing connection..."}
                {status === "live" && "AI Interviewer is active"}
                {status === "stopped" && "Interview Concluded"}
                {status === "error" && "Connection Error"}
              </h2>

              <p className="mt-1 text-sm text-muted-foreground max-w-xs text-pretty break-words">
                {status === "idle" &&
                  "Click 'Start Interview' below when you are ready to begin."}
                {status === "connecting" &&
                  "Initializing microphone and WebSockets..."}
                {status === "live" && "Speak clearly into your microphone."}
                {status === "stopped" &&
                  "Thank you! Your transcript has been saved."}
                {status === "error" &&
                  (errorMessage ??
                    "Failed to connect. Please check mic permissions and try again.")}
              </p>
              </>
              )}

              {/* Waveform Visualization Placeholder (Live feedback) */}
              {status === "live" && (
                <div className="mt-4 sm:mt-6 flex items-center gap-1 h-8">
                  {[40, 70, 30, 90, 60, 100, 50, 80, 40, 70, 30].map(
                    (height, i) => (
                      <span
                        key={i}
                        style={{ height: `${height}%` }}
                        className="w-1 bg-brand rounded-full animate-pulse"
                      />
                    ),
                  )}
                </div>
              )}
            </div>

            {/* Bottom Stage Instructions */}
            {!(screening && submitted) && (
            <div className="w-full text-center text-xs text-muted-foreground border-t border-border/50 pt-3 sm:pt-4">
              <p>
                Ensure your microphone is enabled and ambient noise is minimal.
              </p>
            </div>
            )}
          </div>
        </section>

        {/* Right Column: Live Transcript Panel */}
        <section className="flex-1 min-h-0 md:h-full md:col-span-7 flex flex-col overflow-hidden bg-card">
          {/* Transcript Header */}
          <div className="flex-none px-4 py-3 sm:px-6 sm:py-4 border-b border-border flex items-center justify-between bg-card">
            <div className="flex items-center gap-2">
              <Volume2 className="w-4 h-4 text-muted-foreground" />
              <h3 className="font-semibold text-sm tracking-tight">
                {isActive ? "Live" : "Historical"} Transcript
              </h3>
            </div>
            <span className="text-xs text-muted-foreground bg-secondary px-2.5 py-1 rounded-md font-mono">
              {formatTime(timeLeft)}
            </span>
          </div>

          {/* Transcript Body */}
          <div className="flex-1 min-h-0 relative">
            <div
              ref={scrollContainerRef}
              onScroll={handleScroll}
              className="h-full overflow-y-auto p-4 sm:p-6 space-y-4"
            >
              {/* Screening: this visit's attempt over the last saved one, which may be older. */}
              {historyLines.length > 0 && !isActive && !(screening && lines.length > 0) ? (
                historyLines.map((each) => (
                  <TranscriptBubble line={each} key={each.id} />
                ))
              ) : lines.length === 0 ? (
                <div className="h-full min-h-[200px] flex flex-col items-center justify-center text-center p-6 text-muted-foreground border-2 border-dashed border-border rounded-xl my-auto">
                  <Bot className="w-8 h-8 mb-2 stroke-1 text-muted-foreground/60" />
                  <p className="text-sm font-medium">
                    No conversation history yet
                  </p>
                  <p className="text-xs mt-1 text-muted-foreground/80">
                    Transcripts will stream here in real-time once the interview
                    starts.
                  </p>
                </div>
              ) : (
                lines.map((l, i) => (
                  <TranscriptBubble
                    key={`${l.role}-${l.turn_id ?? i}-${i}`}
                    line={l}
                  />
                ))
              )}
              <div ref={endRef} />
            </div>
            {/* Scroll to bottom floating button when auto-scroll is paused */}
            {!autoScroll && lines.length > 0 && (
              <button
                onClick={() => {
                  setAutoScroll(true);
                  endRef.current?.scrollIntoView({ behavior: "smooth" });
                }}
                className="absolute bottom-5 right-4 bg-card border border-border text-foreground shadow-lg text-xs font-medium px-3 py-1.5 rounded-full flex items-center gap-1.5 hover:bg-secondary transition-all"
              >
                <ChevronDown className="w-3.5 h-3.5" />
                New messages
              </button>
            )}
          </div>

          {/* Controls Dock Bar */}
          <div className="flex-none p-3 sm:p-6 border-t border-border bg-card">
            {screening && submitted ? (
              <SubmittedNextSteps />
            ) : (
            <div className="flex items-center justify-center gap-3 max-w-md mx-auto">
              {screening && saving ? (
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" aria-label="Saving" />
              ) : !isActive ? (
                /* START INTERVIEW BUTTON */
                <Button
                  variant="brand"
                  onClick={start}
                  // disabled={status === "connecting"}
                  className="w-full h-11 flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Play className="w-4 h-4" />
                  {screening
                    ? retryable
                      ? "Try again"
                      : "Start Interview"
                    : status === "stopped" || status === "error"
                      ? "Restart Interview"
                      : "Start Interview"}
                </Button>
              ) : (
                /* LIVE CONTROLS (MUTE / END) */
                <div className="flex items-center gap-3 w-full">
                  <button
                    type="button"
                    onClick={stop}
                    className="flex-1 flex items-center justify-center gap-2 bg-destructive text-destructive-foreground hover:bg-destructive/90 active:scale-[0.99] font-medium h-11 px-6 rounded-lg transition-all"
                  >
                    <PhoneOff className="w-4 h-4" />
                    End Conversation
                  </button>
                </div>
              )}
            </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

function StageText({ title, body }: { title: string; body: string }) {
  return (
    <>
      <h2 className="mt-4 sm:mt-6 text-lg sm:text-2xl font-semibold tracking-tight text-balance">{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground max-w-xs text-pretty break-words">{body}</p>
    </>
  );
}

/** Where a candidate goes once their screening interview is submitted. */
function SubmittedNextSteps() {
  return (
    <div className="max-w-xl mx-auto rounded-xl border border-success/30 bg-success/10 p-3 sm:p-4 flex flex-col lg:flex-row lg:items-center gap-3">
      <p className="hidden lg:flex items-center gap-2 text-sm font-semibold flex-1 min-w-0">
        <CheckCircle2 className="w-5 h-5 shrink-0 text-success" />
        Your interview has been submitted
      </p>
      <div className="flex flex-col lg:flex-row gap-2 lg:shrink-0">
        <Button asChild variant="outline" className="w-full lg:w-auto lg:shrink-0">
          <Link href="/jobs">
            <Search />
            Find jobs
          </Link>
        </Button>
        <Button asChild variant="brand" className="w-full lg:w-auto lg:shrink-0 border border-transparent">
          <Link href="/jobs?tab=applied">
            <ListChecks />
            View applications
          </Link>
        </Button>
      </div>
    </div>
  );
}

/**
 * Individual Transcript Message Bubble Component
 */
function TranscriptBubble({
  line,
}: {
  line: { role: string; text: string; streaming?: boolean };
}) {
  const isUser = line.role === "user";

  if (line.text.trim().length > 0) {
    return (
      <div
        className={`flex items-start gap-3 ${isUser ? "flex-row-reverse" : "flex-row"} ${line?.streaming ? "opacity-70" : ""}`}
      >
        {/* User/AI Avatar */}
        <div
          className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-xs font-semibold ${"bg-secondary text-secondary-foreground border border-border"}`}
        >
          {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
        </div>

        {/* Bubble Container */}
        <div
          className={`flex flex-col min-w-0 max-w-[82%] sm:max-w-[75%] ${isUser ? "items-end" : "items-start"}`}
        >
          <span className="text-[10px] text-muted-foreground mb-1 px-1">
            {isUser ? "You" : "AI Interviewer"}
          </span>
          <div
            className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed break-words ${
              isUser
                ? "bg-secondary text-secondary-foreground rounded-tr-md"
                : "bg-background border rounded-tl-md"
            }`}
          >
            {line.text}
          </div>
        </div>
      </div>
    );
  } else return "";
}
