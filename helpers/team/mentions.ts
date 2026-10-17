/**
 * TM-REQ-009: `@name` mentions in notes. The composer stores a picked mention
 * as an `@[name](user id)` token, so a later rename doesn't break it; a plain
 * `@name` typed without picking is matched against the team by name. Shared
 * by the server (who to email) and the client (rendering, the composer).
 */

export type MentionableMember = { userId: string; name: string };

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
/** A fresh global regex for `@[name](id)` tokens: group 1 is the name, group 2 the id. */
export const mentionTokenPattern = () => new RegExp(`@\\[([^\\]\\n]{1,80})\\]\\((${UUID})\\)`, "gi");

/** The name as it goes inside a token: no brackets, parentheses or newlines. */
export function mentionName(name: string): string {
  return name.replace(/[[\]()\n\r]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

/** The stored token for a picked teammate. */
export function mentionToken(member: MentionableMember): string {
  return `@[${mentionName(member.name) || "teammate"}](${member.userId})`;
}

/** The body with each token shown as `@name` (emails, the agent, excerpts). */
export function mentionsToText(body: string): string {
  return body.replace(mentionTokenPattern(), (_, name: string) => `@${name}`);
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The teammates a note mentions, unique and in order, never the author.
 * Tokens count only when their id is still on the team. Plain `@name` matches
 * a member's name case-insensitively, longest name first, and only after a
 * space or the start of a line, so `a@b.com` isn't a mention.
 */
export function parseMentions(
  body: string,
  members: MentionableMember[],
  authorUserId?: string,
): string[] {
  const memberIds = new Set(members.map((m) => m.userId.toLowerCase()));
  const found: string[] = [];
  const add = (id: string) => {
    const key = id.toLowerCase();
    if (key === authorUserId?.toLowerCase() || !memberIds.has(key)) return;
    const member = members.find((m) => m.userId.toLowerCase() === key);
    if (member && !found.includes(member.userId)) found.push(member.userId);
  };

  for (const match of body.matchAll(mentionTokenPattern())) add(match[2]);

  // Plain mentions, with the tokens blanked out so their names don't match twice.
  const plain = body.replace(mentionTokenPattern(), " ");
  const byLength = members
    .filter((m) => m.name.trim().length > 0)
    .sort((a, b) => b.name.trim().length - a.name.trim().length);
  if (byLength.length === 0 || !plain.includes("@")) return found;

  const alternatives = byLength.map((m) => escapeRegExp(m.name.trim())).join("|");
  const pattern = new RegExp(`(^|[\\s(])@(${alternatives})(?![\\p{L}\\p{N}_])`, "giu");
  for (const match of plain.matchAll(pattern)) {
    const name = match[2].toLowerCase();
    const member = byLength.find((m) => m.name.trim().toLowerCase() === name);
    if (member) add(member.userId);
  }
  return found;
}

/**
 * The `@query` being typed just before the caret, for the composer's picker,
 * or null. The query is what follows the `@`, up to 30 characters, one word.
 */
export function activeMentionQuery(
  text: string,
  caret: number,
): { query: string; start: number } | null {
  const before = text.slice(0, caret);
  const match = /(^|\s)@([^\s@[\]()]{0,30})$/.exec(before);
  if (!match) return null;
  return { query: match[2], start: before.length - match[2].length - 1 };
}

/** Teammates whose name has a word starting with the query (all for an empty query). */
export function filterMentionable(
  members: MentionableMember[],
  query: string,
  limit = 6,
): MentionableMember[] {
  const q = query.trim().toLowerCase();
  return members
    .filter((m) => !q || m.name.toLowerCase().split(/\s+/).some((word) => word.startsWith(q)))
    .slice(0, limit);
}
