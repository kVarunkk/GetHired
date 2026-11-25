// Client-safe. The key that makes "the same job" match across pastes, the
// extension and the board (AT-REQ-004), and the GetHired links that are
// already board jobs (AT-REQ-031 step 1).

/** Query params that only say where a click came from. */
const TRACKING_PARAMS = new Set(["gh_src", "src", "pid", "ref", "source", "lever-source", "trk", "refid", "trackingid"]);

const isTrackingParam = (name: string) => {
  const lower = name.toLowerCase();
  return lower.startsWith("utm_") || TRACKING_PARAMS.has(lower);
};

function parseHttps(url: string): URL | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || !parsed.hostname.includes(".")) return null;
  return parsed;
}

/**
 * `host/path?job-params` for a job link: lowercase host without `www.`, no
 * fragment, no trailing slash, tracking params dropped and the rest sorted.
 * `null` for anything that isn't an https URL.
 */
export function normalizeJobUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const parsed = parseHttps(url);
  if (!parsed) return null;

  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const path = parsed.pathname.replace(/\/+$/, "");
  const params = [...parsed.searchParams.entries()]
    .filter(([name]) => !isTrackingParam(name))
    .sort(([a], [b]) => a.localeCompare(b));
  const query = params.length ? `?${new URLSearchParams(params).toString()}` : "";
  return `${host}${path}${query}`;
}

const GETHIRED_HOSTS = new Set(["gethired.devhub.co.in", "localhost"]);
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const GETHIRED_JOB_PATHS = [new RegExp(`^/jobs/(${UUID})/?$`, "i"), new RegExp(`^/careers/[^/]+/jobs/(${UUID})/?$`, "i")];

/** The `all_jobs` id of a GetHired job page link (`/jobs/<id>`, `/careers/<slug>/jobs/<id>`), else `null`. */
export function parseGetHiredJobUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (!GETHIRED_HOSTS.has(host)) return null;
  if (host === "localhost" ? parsed.protocol !== "http:" && parsed.protocol !== "https:" : parsed.protocol !== "https:") {
    return null;
  }
  for (const pattern of GETHIRED_JOB_PATHS) {
    const match = parsed.pathname.match(pattern);
    if (match) return match[1].toLowerCase();
  }
  return null;
}

/** The domain shown on a card ("boards.greenhouse.io"), or `null`. */
export function jobUrlDomain(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}
