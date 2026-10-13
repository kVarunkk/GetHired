// Tunables for the /agent feature (spec GUD-002).

/** Chat model. A non-lite Flash model for reliable multi-step tool calling. */
export const AGENT_MODEL = "gemini-3.5-flash-lite";
/** Cheap model for session titles and rolling summaries. */
export const AGENT_TITLE_MODEL = "gemini-3.1-flash-lite";

/** Clickable suggested replies shown after each answer. */
export const AGENT_FOLLOW_UP_COUNT = 3;
export const AGENT_FOLLOW_UP_MAX_CHARS = 80;

/**
 * Whether agent traces sent to Arize AX include prompts and outputs (chat
 * text, system prompt with profile and memories, tool inputs and outputs).
 * False keeps tracing (timings, tokens, structure) without the content.
 */
export const AGENT_TRACE_CONTENT = true;

/** Max model steps (tool calls + final answer) per user turn. */
export const AGENT_MAX_STEPS = 8;
/** Credit-spending tool calls allowed per user turn; more are denied (SEC-013). */
export const AGENT_MAX_CREDIT_CALLS_PER_TURN = 2;

/** Gemini safety settings for the chat model (REQ-030). */
export const AGENT_SAFETY_SETTINGS = [
  { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
  { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
  { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
] as const;

/** Shown when the safety filter blocks a reply (REQ-030). */
export const AGENT_CONTENT_FILTER_MESSAGE =
  "I can't help with that. I can help you find jobs, review your resume, track applications and practise interviews.";

/** Most recent messages sent to the model verbatim (REQ-007). */
export const AGENT_CONTEXT_WINDOW = 20;
/** Unsummarised messages beyond which older ones get folded into the summary. */
export const AGENT_SUMMARY_TRIGGER = 30;
/** Turns whose tool outputs are kept in full; older outputs are stubbed (REQ-008). */
export const AGENT_FULL_TOOL_OUTPUT_TURNS = 4;

/**
 * Long-term memories per user (REQ-010). Every memory goes into every
 * prompt, so the set stays small: about 1.5k tokens at worst.
 */
export const AGENT_MAX_MEMORIES = 30;
export const AGENT_MEMORY_MAX_CHARS = 200;
export const AGENT_MEMORY_CATEGORIES = [
  "preference",
  "goal",
  "constraint",
  "fact",
] as const;
export type AgentMemoryCategory = (typeof AGENT_MEMORY_CATEGORIES)[number];

/** User messages per user per UTC day across all sessions (REQ-018). */
export const AGENT_DAILY_MESSAGE_CAP = 20;
/** Times the reply to one user message can be regenerated. */
export const AGENT_MAX_REGENERATIONS = 3;
/** Max characters of text in one user message. */
export const AGENT_MAX_MESSAGE_CHARS = 4000;

/** Default and max items returned by list tools (GUD-001). */
export const AGENT_LIST_DEFAULT_LIMIT = 10;
export const AGENT_LIST_MAX_LIMIT = 20;
/** Job descriptions returned by getJobDetails are trimmed to this length. */
export const AGENT_JOB_DESCRIPTION_MAX_CHARS = 2000;
