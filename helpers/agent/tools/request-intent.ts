import { isTextUIPart, type UIMessage } from "ai";

/**
 * What the user's own words in this turn say about a job search, for the
 * guards the prompt alone didn't hold (agent chat review 2026-11-20).
 *
 * The text is the turn's request (`turnRequestText`): the latest user
 * message plus any card answers since. MCP calls have none, so these checks
 * only run in the chat.
 */

const ROLE_NOUNS =
  "(?:roles?|jobs?|fields?|positions?|openings?|domains?|categor(?:y|ies)|industr(?:y|ies)|kinds?|types?|sorts?)";

/**
 * Words that turn "any/all X jobs" into a request for more of the same role
 * ("any more jobs", "all matching jobs"), so they don't count as any role.
 */
const SAME_ROLE_WORDS = "(?:more|other|matching|relevant|similar|suitable|good|better|new|such|of my|for me)";

const ANY_ROLE_PATTERNS: readonly RegExp[] = [
  // "any role", "all kinds of jobs", "every type of position", "any remote job"
  new RegExp(
    `\\b(?:any|all|every)\\s+(?:(?:kinds?|types?|sorts?)\\s+of\\s+)?(?:(?!${SAME_ROLE_WORDS}\\b)[\\p{L}-]+\\s+)?${ROLE_NOUNS}\\b`,
    "iu",
  ),
  /\b(?:anything|whatever)\b/i,
  /\b(?:regardless of|no matter (?:the|what)|doesn'?t matter (?:the|what))\s+(?:the\s+)?(?:role|field|job|title)\b/i,
  /\b(?:different|other|unrelated)\s+(?:roles?|fields?|domains?|industr(?:y|ies))\b/i,
  /\bnot just\s+(?:my\s+)?(?:role|field)\b/i,
];

/**
 * Whether the user asked for jobs of any role, so a search without title
 * keywords is what they want. "Show more remote jobs" is not: it asks for
 * more of their role (traces 95571a1f and edf8278a turns 2 and 6).
 */
export function asksForAnyRole(text: string): boolean {
  return ANY_ROLE_PATTERNS.some((pattern) => pattern.test(text));
}

const LEVEL_PATTERN =
  /\b(?:fresher|freshers|fresh graduates?|new grads?|graduates?|entry[- ]?level|junior|jr|intern|interns|internships?|trainees?|senior|sr|lead|principal|staff|mid[- ]?level|mid[- ]?senior|experienced)\b|\b\d+\+?\s*(?:years?|yrs?)\b/i;

/**
 * Whether the user named a level ("fresher backend roles", "senior ones",
 * "jobs for 3 years experience"). Its experience range is then what they
 * asked for, so the search never widens it (turn 3: a fresher shown 3–6
 * year jobs).
 */
export function namesExperienceLevel(text: string): boolean {
  return LEVEL_PATTERN.test(text);
}

/** Everything the user typed in the chat, oldest first: where a pasted job description comes from. */
export function chatUserText(history: readonly UIMessage[]): string {
  return history
    .filter((message) => message.role === "user")
    .flatMap((message) => message.parts.filter(isTextUIPart).map((part) => part.text))
    .join("\n");
}

/** Words that carry the text's content: 4+ letters or digits, lowercased. */
const contentWords = (text: string) => new Set(text.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []);

/** How much of a job description must come from the user's own words to count as pasted. */
export const PASTED_WORD_SHARE = 0.6;

/**
 * Whether the user pasted this job description, rather than the model writing
 * one: most of its words appear in what the user typed. Word overlap, not an
 * exact match, so a copy the model reformatted still counts. A description
 * written from "tailor my resume for AI engineer roles" shares almost none.
 */
export function pastedByUser(jobDescription: string, userText: string): boolean {
  const words = contentWords(jobDescription);
  if (words.size === 0) return false;
  const typed = contentWords(userText);
  let shared = 0;
  for (const word of words) if (typed.has(word)) shared += 1;
  return shared / words.size >= PASTED_WORD_SHARE;
}
