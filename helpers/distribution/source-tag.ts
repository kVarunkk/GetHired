/** MP-REQ-005/006: the `?src=<channel>&pid=<posting id>` tag on feed URLs. Client-safe. */

export const KNOWN_CHANNELS = ["google", "bing", "jooble", "adzuna", "talent", "ziprecruiter", "indeed", "naukri"] as const;

export type SourceTag = { channel: string; pid: string | null };

const SAFE = /^[A-Za-z0-9_-]{1,40}$/;

/** No `src` means the application started on GetHired (null). Unknown tags become `other`. */
export function readSourceTag(params: URLSearchParams): SourceTag | null {
  const raw = params.get("src")?.trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  const channel = SAFE.test(raw) && (KNOWN_CHANNELS as readonly string[]).includes(lower) ? lower : "other";
  const pid = params.get("pid")?.trim();
  return { channel, pid: pid && SAFE.test(pid) ? pid : null };
}

/** The query string that carries the tag through a redirect such as sign-up. */
export function sourceTagQuery(tag: SourceTag | null): string {
  if (!tag) return "";
  const q = new URLSearchParams({ src: tag.channel });
  if (tag.pid) q.set("pid", tag.pid);
  return q.toString();
}
