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
} from "lucide-react";
import BackButton from "./BackButton";
import { TInterviewServer } from "@/utils/types/interview.types";
import Link from "next/link";
import { Button } from "./ui/button";
import toast from "react-hot-toast";
import ModifiedLink from "./ModifiedLink";

interface InterviewComponentProps {
  interviewId: string;
  interview: TInterviewServer;
  sessionHistory: {
    id: string;
    started_at: string;
    status: string;
    analysisStatus: string | null;
  }[];
}

export default function InterviewComponent({
  interviewId,
  interview,
  sessionHistory,
}: InterviewComponentProps) {
  const { status, errorMessage, lines, analysisSession, start, stop } =
    useVoiceAgent(interviewId);
  const [autoScroll, setAutoScroll] = useState(true);
  const [timeLeft, setTimeLeft] = useState(5 * 60);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const isActive = status === "connecting" || status === "live";

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

  const latestAnalysisSessionId =
    analysisSession?.sessionId ??
    [...sessionHistory]
      .reverse()
      .find((session) => session.analysisStatus !== null)?.id;

  // Auto scroll transcript to bottom as new messages arrive
  useEffect(() => {
    if (autoScroll) {
      endRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [lines, autoScroll]);

  useEffect(() => {
    if (status === "idle" || status === "stopped" || status === "error") {
      setTimeLeft(5 * 60);
    }

    if (status !== "live") {
      return;
    }

    const timer = window.setInterval(() => {
      setTimeLeft((prev) => Math.max(0, prev - 1));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [status]);

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
    <div className="flex flex-col h-screen max-h-screen bg-background text-foreground overflow-hidden">
      {/* Top Header Bar */}
      <header className="flex-none border-b border-border bg-card px-4 py-3 sm:px-6 flex items-center justify-between z-10 shadow-sm">
        <div className="flex items-center space-x-3">
          <BackButton />
          <div>
            <h1 className="text-base sm:text-lg font-semibold tracking-tight leading-tight truncate">
              {interview.name || "AI Interview"}
            </h1>
            <div className="flex items-center flex-wrap gap-1">
              <Link
                className="text-xs text-muted-foreground underline underline-offset-4 flex items-center gap-1"
                href={"/jobs/" + interview.job_id}
                target="_blank"
              >
                <Briefcase size={14} /> {interview.all_jobs?.job_name}
              </Link>
              <Link
                className="text-xs text-muted-foreground underline underline-offset-4 flex items-center gap-1"
                href={"/resume/" + interview.resume_id}
                target="_blank"
              >
                <FileUser size={14} /> {interview.resumes?.name}
              </Link>
            </div>
          </div>
        </div>

        {/* Status Badge */}
        <div className="flex items-center gap-2">
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
      <main className="flex-1 grid grid-cols-1 lg:grid-cols-12 overflow-hidden bg-background">
        {/* Left Column: AI Stage & Visualizer */}
        <section className="lg:col-span-5 flex flex-col justify-between items-center p-6 bg-secondary/30 border-b lg:border-b-0 lg:border-r border-border relative overflow-hidden">
          {/* Decorative ambient background blur */}
          <div className="absolute -top-24 -left-24 w-72 h-72 bg-[hsl(var(--brand))]/10 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-24 -right-24 w-72 h-72 bg-[hsl(var(--brand-soft))]/10 rounded-full blur-3xl pointer-events-none" />

          {/* Top Info Tag */}
          <div className="w-full flex justify-between items-center text-xs text-muted-foreground z-10">
            <span className="flex items-center gap-1.5 font-medium">
              <Radio
                className={`w-3.5 h-3.5 ${status === "live" ? "text-emerald-500 animate-pulse" : ""}`}
              />
              {status === "live" ? "Voice Session Active" : "Session Offline"}
            </span>
            <span>16 kHz / Mono PCM</span>
          </div>

          {/* Center Stage: AI Avatar & Audio Visualizer */}
          <div className="my-auto flex flex-col items-center justify-center text-center z-10 py-8">
            <div className="relative flex items-center justify-center">
              {/* Pulsing Aura when AI is speaking / live */}
              {status === "live" && (
                <>
                  <div className="absolute w-44 h-44 sm:w-56 sm:h-56 rounded-full bg-[hsl(var(--brand))]/15 animate-ping opacity-75" />
                  <div className="absolute w-36 h-36 sm:w-48 sm:h-48 rounded-full bg-[hsl(var(--brand))]/25 animate-pulse" />
                </>
              )}

              {/* Connecting Spinner Background */}
              {status === "connecting" && (
                <div className="absolute w-36 h-36 sm:w-48 sm:h-48 rounded-full border-2 border-dashed border-[hsl(var(--brand))] animate-spin" />
              )}

              {/* Central Avatar Box */}
              <div
                className={`relative w-24 h-24 sm:w-36 sm:h-36 rounded-full flex items-center justify-center shadow-xl transition-all duration-300 border-2 ${
                  status === "live"
                    ? "bg-[hsl(var(--brand))] text-white border-white/20 scale-105"
                    : status === "connecting"
                      ? "bg-card text-[hsl(var(--brand))] border-[hsl(var(--brand))]"
                      : "bg-muted text-muted-foreground border-border"
                }`}
              >
                {status === "connecting" ? (
                  <Loader2 className="w-12 h-12 sm:w-16 sm:h-16 animate-spin text-[hsl(var(--brand))]" />
                ) : (
                  <Bot className="w-12 h-12 sm:w-16 sm:h-16" />
                )}
              </div>
            </div>

            {/* AI Status Text */}
            <h2 className="mt-6 text-xl sm:text-2xl font-semibold tracking-tight">
              {status === "idle" && "Ready to start interview"}
              {status === "connecting" && "Establishing connection..."}
              {status === "live" && "AI Interviewer is active"}
              {status === "stopped" && "Interview Concluded"}
              {status === "error" && "Connection Error"}
            </h2>

            <p className="mt-1 text-sm text-muted-foreground max-w-xs">
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

            {/* Waveform Visualization Placeholder (Live feedback) */}
            {status === "live" && (
              <div className="mt-6 flex items-center gap-1 h-8">
                {[40, 70, 30, 90, 60, 100, 50, 80, 40, 70, 30].map(
                  (height, i) => (
                    <span
                      key={i}
                      style={{ height: `${height}%` }}
                      className="w-1 bg-[hsl(var(--brand))] rounded-full animate-pulse"
                    />
                  ),
                )}
              </div>
            )}
          </div>

          {/* Bottom Stage Instructions */}
          <div className="w-full text-center text-xs text-muted-foreground z-10 border-t border-border/50 pt-4">
            <p>
              Ensure your microphone is enabled and ambient noise is minimal.
            </p>
          </div>
        </section>

        {/* Right Column: Live Transcript Panel */}
        <section className="lg:col-span-7 flex flex-col h-full overflow-hidden bg-card">
          {/* Transcript Header */}
          <div className="flex-none px-6 py-4 border-b border-border flex items-center justify-between bg-card">
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
              {historyLines.length > 0 && !isActive ? (
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
          <div className="flex-none p-4 sm:p-6 border-t border-border bg-card">
            <div className="flex items-center justify-center gap-3 max-w-md mx-auto">
              {!isActive ? (
                /* START INTERVIEW BUTTON */
                <Button
                  onClick={start}
                  // disabled={status === "connecting"}
                  className="w-full flex items-center justify-center gap-2  font-semibold py-3.5 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Play className="w-5 h-5 " />
                  {status === "stopped" || status === "error"
                    ? "Restart Interview"
                    : "Start Interview"}
                </Button>
              ) : (
                /* LIVE CONTROLS (MUTE / END) */
                <div className="flex items-center gap-3 w-full">
                  <button
                    type="button"
                    onClick={stop}
                    className="flex-1 flex items-center justify-center gap-2 bg-destructive text-destructive-foreground hover:bg-destructive/90 active:scale-[0.99] font-medium py-3.5 px-6 rounded-xl shadow-md transition-all"
                  >
                    <PhoneOff className="w-5 h-5" />
                    End Conversation
                  </button>
                </div>
              )}
            </div>
          </div>
        </section>
      </main>
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
          className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-xs font-semibold shadow-sm ${"bg-secondary text-secondary-foreground border border-border"}`}
        >
          {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
        </div>

        {/* Bubble Container */}
        <div
          className={`flex flex-col max-w-[82%] sm:max-w-[75%] ${isUser ? "items-end" : "items-start"}`}
        >
          <span className="text-[10px] text-muted-foreground mb-1 px-1">
            {isUser ? "You" : "AI Interviewer"}
          </span>
          <div
            className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed shadow-sm ${
              isUser
                ? "bg-[hsl(var(--brand))] text-white rounded-tr-none"
                : "bg-secondary text-secondary-foreground border border-border/80 rounded-tl-none"
            }`}
          >
            {line.text}
          </div>
        </div>
      </div>
    );
  } else return "";
}
