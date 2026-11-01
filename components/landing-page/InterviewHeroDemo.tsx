"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { InterviewView, type VoiceAgent } from "@/components/InterviewComponent";
import type { Line, Status } from "@/hooks/useVoiceAgent";
import {
  DEMO_INTERVIEW,
  DEMO_INTERVIEW_ID,
  DEMO_SCRIPT,
  DEMO_SESSION_HISTORY,
  type DemoTurn,
} from "./interview-demo";

// A sample mock interview for the AI interview page's hero. It renders the
// interview page's own InterviewView, driven by a scripted voice agent instead
// of useVoiceAgent: Start connects, then the transcript streams in as the
// interviewer and the candidate take turns, the timer counts down, and End
// Conversation stops it. It never opens the mic or a socket.

export const DEMO_CONNECT_MS = 1200;
export const DEMO_WORD_MS = 70;
export const DEMO_PAUSE_MS = 900;

type Step = { delay: number; run: () => void };

/** The steps that stream one line in word by word, then mark it finished. */
function streamLine(
  role: "assistant" | "user",
  turnId: string,
  text: string,
  setLines: (update: (lines: Line[]) => Line[]) => void,
): Step[] {
  const words = text.split(" ");
  const steps: Step[] = [
    { delay: DEMO_PAUSE_MS, run: () => setLines((lines) => [...lines, { role, turn_id: turnId, text: "", streaming: true }]) },
  ];
  words.forEach((_, index) => {
    const partial = words.slice(0, index + 1).join(" ");
    steps.push({
      delay: DEMO_WORD_MS,
      run: () =>
        setLines((lines) => [
          ...lines.slice(0, -1),
          { role, turn_id: turnId, text: partial, streaming: index < words.length - 1 },
        ]),
    });
  });
  return steps;
}

export function useScriptedVoice(script: DemoTurn[]): VoiceAgent {
  const [status, setStatus] = useState<Status>("idle");
  const [lines, setLines] = useState<Line[]>([]);
  const timer = useRef<number | undefined>(undefined);

  const clear = () => window.clearTimeout(timer.current);
  useEffect(() => clear, []);

  const start = useCallback(async () => {
    clear();
    setLines([]);
    setStatus("connecting");

    const steps: Step[] = [{ delay: DEMO_CONNECT_MS, run: () => setStatus("live") }];
    script.forEach((turn, index) => {
      const turnId = `demo-${index}`;
      steps.push(...streamLine("assistant", turnId, turn.assistant, setLines));
      if (turn.user) steps.push(...streamLine("user", turnId, turn.user, setLines));
    });

    const runFrom = (index: number) => {
      const step = steps[index];
      if (!step) return;
      timer.current = window.setTimeout(() => {
        step.run();
        runFrom(index + 1);
      }, step.delay);
    };
    runFrom(0);
  }, [script]);

  const stop = useCallback(async () => {
    clear();
    setLines((current) => current.map((line) => ({ ...line, streaming: false })));
    setStatus("stopped");
  }, []);

  return { status, errorMessage: null, lines, analysisSession: null, start, stop };
}

/** The played lines as saved turns, one per turn id, as the voice server stores them. */
function linesToTurns(lines: Line[]) {
  const turns = new Map<string, { turn_id: string; user: string; assistant: string }>();
  for (const line of lines) {
    const turn = turns.get(line.turn_id) ?? { turn_id: line.turn_id, user: "", assistant: "" };
    if (line.role === "user") turn.user = line.text;
    else turn.assistant = line.text;
    turns.set(line.turn_id, turn);
  }
  return [...turns.values()];
}

export default function InterviewHeroDemo() {
  const voice = useScriptedVoice(DEMO_SCRIPT);

  // Once ended, the played session is the latest saved one, as after a reload.
  const ended = voice.status === "stopped" && voice.lines.length > 0;
  const interview = useMemo(
    () =>
      ended
        ? {
            ...DEMO_INTERVIEW,
            interview_sessions: [{ id: DEMO_SESSION_HISTORY[0].id, turns: linesToTurns(voice.lines) }],
          }
        : DEMO_INTERVIEW,
    [ended, voice.lines],
  );

  return (
    <section
      aria-label="Example AI mock interview"
      className="h-[38rem] w-full overflow-hidden rounded-xl border bg-background text-left"
    >
      <InterviewView
        embedded
        interviewId={DEMO_INTERVIEW_ID}
        interview={interview}
        sessionHistory={DEMO_SESSION_HISTORY}
        voice={voice}
      />
    </section>
  );
}
