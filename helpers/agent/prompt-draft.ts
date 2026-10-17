/**
 * A message to start /agent with, e.g. typed into the landing-page demo.
 * It travels as `/agent?prompt=…` and only fills the message box: the user
 * still sends it, so a link can't make the agent act on its own.
 *
 * Logging in drops query params, so the text is also kept in sessionStorage
 * and picked up when /agent opens without one.
 */

export const PROMPT_PARAM = "prompt";

/** Where each role's agent lives: applicants at /agent, companies under /company. */
export const AGENT_PATH = "/agent";
export const COMPANY_AGENT_PATH = "/company/agent";
export const MAX_PROMPT_CHARS = 2000;

const STORAGE_KEY = "gethired:agent-prompt";
/** A saved prompt older than this is ignored (the visitor wandered off). */
const PENDING_TTL_MS = 60 * 60 * 1000;

/** The prompt from a query param, trimmed and capped; "" when absent. */
export function readPromptParam(value: unknown): string {
  const text = Array.isArray(value) ? value[0] : value;
  return typeof text === "string" ? text.trim().slice(0, MAX_PROMPT_CHARS) : "";
}

/** The agent link (`base`, /agent by default) that opens a new chat with `text` in the message box. */
export function agentPromptHref(text: string, base: string = AGENT_PATH) {
  const prompt = readPromptParam(text);
  return prompt ? `${base}?${PROMPT_PARAM}=${encodeURIComponent(prompt)}` : base;
}

export function savePendingPrompt(text: string) {
  const prompt = readPromptParam(text);
  try {
    if (prompt) {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ prompt, savedAt: Date.now() }));
    }
  } catch {
    // Storage blocked: the query param still works when already logged in.
  }
}

/** Returns the saved prompt, if it's recent, and forgets it. */
export function takePendingPrompt(): string {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    sessionStorage.removeItem(STORAGE_KEY);
    if (!raw) return "";
    const { prompt, savedAt } = JSON.parse(raw) as { prompt?: unknown; savedAt?: unknown };
    if (typeof savedAt !== "number" || Date.now() - savedAt > PENDING_TTL_MS) return "";
    return readPromptParam(prompt);
  } catch {
    return "";
  }
}

/** Opens the agent ready to set up the user's profile (see ONBOARDING in system-prompt.ts). */
export const ONBOARDING_PROMPT =
  "Help me complete my onboarding. Ask me for the missing profile details a few at a time, then set up my profile.";

/** Opens the agent ready to review and update an onboarded user's profile. */
export const PROFILE_UPDATE_PROMPT =
  "Review my profile with me. Summarise what it says now, suggest changes that would improve my job matches, and update it once I agree.";
