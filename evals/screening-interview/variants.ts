import type { ConfigSnapshot, TranscriptTurn } from "@/helpers/interview/screening/schemas";
import { INJECTION_LINE, PERSONAS, type ScriptedCase } from "./transcripts";

type Persona = (typeof PERSONAS)[keyof typeof PERSONAS];

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function fill(text: string, p: Persona): string {
  return text
    .replaceAll("{name}", p.name)
    .replaceAll("{They}", capitalise(p.they))
    .replaceAll("{they}", p.they)
    .replaceAll("{Them}", capitalise(p.them))
    .replaceAll("{them}", p.them)
    .replaceAll("{Their}", capitalise(p.their))
    .replaceAll("{their}", p.their);
}

// Speech-to-text-style mistakes on common words and technical terms.
const STT_SWAPS: [RegExp, string][] = [
  [/\btheir\b/gi, "there"],
  [/\bit's\b/gi, "its"],
  [/\bwould have\b/gi, "would of"],
  [/\ba lot\b/gi, "alot"],
  [/\bSQL\b/g, "sequel"],
  [/\bAPI\b/g, "a p i"],
  [/\bcache\b/gi, "cash"],
  [/\bPostgres\b/g, "post gress"],
  [/\bKubernetes\b/g, "cooper netties"],
  [/\bRedis\b/g, "red is"],
  [/\bweight\b/gi, "wait"],
];
const FILLERS = ["um", "like", "you know", "uh", "so yeah"];

/**
 * The same content as speech recognition might deliver it: lower case, no
 * punctuation, filler words every few words, a broken grammar pattern and
 * homophone errors. Deterministic, so a rerun is comparable.
 */
export function speechNoise(text: string): string {
  let out = text;
  for (const [pattern, replacement] of STT_SWAPS) out = out.replace(pattern, replacement);
  out = out
    .replace(/\bI was\b/g, "I were")
    .replace(/\bdoesn't\b/g, "don't")
    .toLowerCase()
    .replace(/[.,;:!?]/g, "");
  const words = out.split(/\s+/).filter(Boolean);
  return words.flatMap((w, i) => (i > 0 && i % 7 === 0 ? [FILLERS[(i / 7 - 1) % FILLERS.length], w] : [w])).join(" ");
}

export type Variant = "original" | "swapped" | "noisy" | "injected";

export function buildTurns(c: ScriptedCase, variant: Variant): TranscriptTurn[] {
  const persona = variant === "swapped" ? PERSONAS.b : PERSONAS.a;
  return c.turns.map(([user, assistant], i) => {
    let said = fill(user, persona);
    if (variant === "noisy" && i > 0) said = speechNoise(said);
    // The injection rides on the last substantive answer.
    if (variant === "injected" && i === c.turns.length - 2) said = `${said} ${INJECTION_LINE}`;
    return { turn_id: i, timestamp: 1_760_000_000 + i * 30, user: said, assistant: fill(assistant, persona), interrupted: false };
  });
}

export function snapshotOf(c: ScriptedCase): ConfigSnapshot {
  return {
    questions: c.questions.map((text) => ({ text })),
    competencies: c.competencies,
    duration_minutes: 15,
    deadline_days: 5,
    language: "en",
    company_name: "Eval Co",
    job_title: c.jobTitle,
  };
}
