import "server-only";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

// Fetches a page a user pasted (AT-REQ-037) without letting the link reach
// our own network: https only, no IP literals, every resolved address must be
// public, redirects are followed by hand and each hop is checked again, with a
// timeout and a byte cap.
//
// Known gap: `fetch` resolves the host again, so a DNS answer that changes
// between our lookup and the connect (rebinding) isn't caught. Pinning the
// address needs a custom dispatcher; the response is only ever parsed for
// job details, never returned raw.

export type SafeFetchFailure =
  | "invalid_url"
  | "blocked_host"
  | "too_many_redirects"
  | "bad_status"
  | "bad_content_type"
  | "too_large"
  | "timeout"
  | "network";

export type SafeFetchResult =
  | { ok: true; url: string; status: number; contentType: string; body: string }
  | { ok: false; reason: SafeFetchFailure; status?: number };

export type LookupFn = (hostname: string) => Promise<{ address: string; family: number }[]>;

export type SafeFetchOptions = {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  /** Content types accepted, matched on the media type. */
  accept?: string[];
  lookup?: LookupFn;
  fetch?: typeof fetch;
};

const DEFAULTS = { timeoutMs: 8000, maxBytes: 1024 * 1024, maxRedirects: 3, accept: ["text/html", "application/xhtml+xml"] };

const defaultLookup: LookupFn = (hostname) => dnsLookup(hostname, { all: true, verbatim: true });

function ipv4Parts(address: string): number[] | null {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return parts;
}

function isPrivateIpv4(address: string): boolean {
  const parts = ipv4Parts(address);
  if (!parts) return true;
  const [a, b] = parts;
  return (
    a === 0 || // this network
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && parts[2] === 0) || // IETF protocol assignments
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    a >= 224 // multicast and reserved
  );
}

/** Expands an IPv6 address to its eight 16-bit groups. */
function ipv6Groups(address: string): number[] | null {
  let text = address.toLowerCase().split("%")[0];
  // An embedded IPv4 tail (::ffff:1.2.3.4).
  const v4 = text.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const parts = ipv4Parts(v4[1]);
    if (!parts) return null;
    text = text.slice(0, -v4[1].length) + `${((parts[0] << 8) | parts[1]).toString(16)}:${((parts[2] << 8) | parts[3]).toString(16)}`;
  }
  const [head, tail] = text.split("::");
  const headGroups = head ? head.split(":") : [];
  const tailGroups = tail ? tail.split(":") : [];
  const missing = 8 - headGroups.length - tailGroups.length;
  if (text.includes("::") ? missing < 0 : missing !== 0) return null;
  const groups = [...headGroups, ...Array(text.includes("::") ? missing : 0).fill("0"), ...tailGroups].map((group) =>
    parseInt(group, 16),
  );
  return groups.length === 8 && groups.every((group) => Number.isInteger(group) && group >= 0 && group <= 0xffff) ? groups : null;
}

function isPrivateIpv6(address: string): boolean {
  const groups = ipv6Groups(address);
  if (!groups) return true;
  if (groups.every((group) => group === 0)) return true; // ::
  if (groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1) return true; // ::1
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d).
  if (groups.slice(0, 5).every((group) => group === 0) && (groups[5] === 0xffff || groups[5] === 0)) {
    return isPrivateIpv4(`${groups[6] >> 8}.${groups[6] & 0xff}.${groups[7] >> 8}.${groups[7] & 0xff}`);
  }
  const first = groups[0];
  return (
    (first & 0xfe00) === 0xfc00 || // fc00::/7 unique local
    (first & 0xffc0) === 0xfe80 || // fe80::/10 link-local
    (first & 0xffc0) === 0xfec0 || // fec0::/10 site-local
    (first & 0xff00) === 0xff00 || // multicast
    first === 0x2002 || // 6to4 can wrap any IPv4
    (first === 0x0064 && groups[1] === 0xff9b) || // NAT64
    (first === 0x2001 && groups[1] === 0x0db8) // documentation
  );
}

/** Whether an address is anything but a public unicast address. */
export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPrivateIpv4(address);
  if (family === 6) return isPrivateIpv6(address);
  return true;
}

/** An https URL whose host is a public name (no IP literal, no localhost), or null. */
export function parsePublicHttpsUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  if (url.port && url.port !== "443") return null;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  // WHATWG URL already turns 2130706433, 0x7f.1 and similar into dotted IPv4.
  if (!host || isIP(host.replace(/^\[|\]$/g, "")) !== 0 || host.startsWith("[")) return null;
  if (!host.includes(".") || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    return null;
  }
  return url;
}

async function hostIsPublic(hostname: string, lookup: LookupFn): Promise<boolean> {
  try {
    const addresses = await lookup(hostname);
    return addresses.length > 0 && addresses.every(({ address }) => !isPrivateAddress(address));
  } catch {
    return false;
  }
}

async function readCapped(response: Response, maxBytes: number): Promise<string | null> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

/** GETs a public https page. Never throws. */
export async function safeFetch(rawUrl: string, options: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const { timeoutMs, maxBytes, maxRedirects, accept } = { ...DEFAULTS, ...options };
  const lookup = options.lookup ?? defaultLookup;
  const doFetch = options.fetch ?? fetch;
  const signal = AbortSignal.timeout(timeoutMs);

  let url = parsePublicHttpsUrl(rawUrl);
  if (!url) return { ok: false, reason: "invalid_url" };

  try {
    for (let hop = 0; ; hop++) {
      if (!(await hostIsPublic(url.hostname, lookup))) return { ok: false, reason: "blocked_host" };

      const response = await doFetch(url.toString(), {
        method: "GET",
        redirect: "manual",
        signal,
        headers: { accept: "text/html,application/xhtml+xml;q=0.9", "user-agent": "GetHiredBot/1.0 (+job tracker link preview)" },
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        await response.body?.cancel().catch(() => {});
        if (!location) return { ok: false, reason: "bad_status", status: response.status };
        if (hop >= maxRedirects) return { ok: false, reason: "too_many_redirects" };
        const next = parsePublicHttpsUrl(new URL(location, url).toString());
        if (!next) return { ok: false, reason: "blocked_host" };
        url = next;
        continue;
      }

      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        return { ok: false, reason: "bad_status", status: response.status };
      }

      const contentType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      if (!accept.includes(contentType)) {
        await response.body?.cancel().catch(() => {});
        return { ok: false, reason: "bad_content_type" };
      }

      const body = await readCapped(response, maxBytes);
      if (body === null) return { ok: false, reason: "too_large" };
      return { ok: true, url: url.toString(), status: response.status, contentType, body };
    }
  } catch (error) {
    if (signal.aborted || (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError"))) {
      return { ok: false, reason: "timeout" };
    }
    return { ok: false, reason: "network" };
  }
}
