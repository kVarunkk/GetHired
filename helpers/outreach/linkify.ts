// OR-SEC-002: outreach messages are company-written text shown to candidates.
// They're rendered as plain text; the only markup is a link around a bare
// `https://` URL. No markdown, no HTML, no other schemes. Client-safe.

export type TextSegment = { type: "text"; value: string } | { type: "link"; value: string };

// Stops at whitespace and at characters that commonly close a sentence or
// wrap a URL in prose.
const HTTPS_URL = /https:\/\/[^\s<>"'()[\]{}]+/g;
const TRAILING = /[.,;:!?]+$/;

/** Splits one line of text into text and `https://` link segments. */
export function linkify(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(HTTPS_URL)) {
    const start = match.index ?? 0;
    let url = match[0];
    const trailing = url.match(TRAILING)?.[0] ?? "";
    if (trailing) url = url.slice(0, -trailing.length);
    if (url.length <= "https://".length) continue;
    if (start > last) segments.push({ type: "text", value: text.slice(last, start) });
    segments.push({ type: "link", value: url });
    last = start + url.length;
  }
  if (last < text.length) segments.push({ type: "text", value: text.slice(last) });
  return segments;
}

/** Paragraphs (split on blank lines), each a list of lines. */
export function paragraphs(text: string): string[][] {
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.split("\n"))
    .filter((lines) => lines.some((l) => l.trim() !== ""));
}

/** The first word of a full name, for greetings. */
export function firstName(fullName: string | null | undefined): string | null {
  const first = fullName?.trim().split(/\s+/)[0];
  return first ? first : null;
}
