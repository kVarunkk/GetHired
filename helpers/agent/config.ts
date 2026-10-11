// Tunables for the /agent feature (spec GUD-002).

/** Chat model. A non-lite Flash model for reliable multi-step tool calling. */
export const AGENT_MODEL = "gemini-3.5-flash-lite";
/** Cheap model for session titles and rolling summaries. */
export const AGENT_TITLE_MODEL = "gemini-3.1-flash-lite";

/** Clickable suggested replies shown after each answer. */
export const AGENT_FOLLOW_UP_COUNT = 3;
export const AGENT_FOLLOW_UP_MAX_CHARS = 80;

/** Max model steps (tool calls + final answer) per user turn. */
export const AGENT_MAX_STEPS = 8;

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
/** Max characters of text in one user message. */
export const AGENT_MAX_MESSAGE_CHARS = 4000;

/** Default and max items returned by list tools (GUD-001). */
export const AGENT_LIST_DEFAULT_LIMIT = 10;
export const AGENT_LIST_MAX_LIMIT = 20;
/** Job descriptions returned by getJobDetails are trimmed to this length. */
export const AGENT_JOB_DESCRIPTION_MAX_CHARS = 2000;
