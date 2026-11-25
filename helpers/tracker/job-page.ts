// Pure. Reads a job's title, company and location out of a fetched page
// (AT-REQ-037): schema.org JobPosting JSON-LD first, then og/title tags.
// Nothing here calls a model; the page text for one comes from `pageText`.

import { TRACKER_LIMITS, stripControlChars } from "./schema";

export type PageJob = { jobTitle: string; companyName: string; location: string | null; description?: string | null };

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—" };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const point = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(point) && point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

/** One line of plain text, capped; null when blank. */
function clean(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = stripControlChars(decodeEntities(value).replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
  return text ? text.slice(0, max) : null;
}

/** Multi-line plain text (a description): block tags become line breaks, the rest of the markup goes. */
export function cleanBlock(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = stripControlChars(
    decodeEntities(
      value
        .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\b[^>]*>/gi, "\n")
        .replace(/<li\b[^>]*>/gi, "- ")
        .replace(/<[^>]*>/g, ""),
    ),
  )
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text ? text.slice(0, max) : null;
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

const isObject = (value: unknown): value is Record<string, Json> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const typesOf = (node: Record<string, Json>): string[] => {
  const type = node["@type"];
  return (Array.isArray(type) ? type : [type]).filter((t): t is string => typeof t === "string");
};

/** Every JobPosting node in a JSON-LD value: top level, arrays and `@graph`. */
function findJobPostings(value: Json, depth = 0): Record<string, Json>[] {
  if (depth > 4) return [];
  if (Array.isArray(value)) return value.flatMap((item) => findJobPostings(item, depth + 1));
  if (!isObject(value)) return [];
  const found = typesOf(value).some((type) => type.replace(/^https?:\/\/schema\.org\//, "") === "JobPosting") ? [value] : [];
  if (value["@graph"]) found.push(...findJobPostings(value["@graph"], depth + 1));
  return found;
}

function organizationName(value: Json | undefined): string | null {
  if (typeof value === "string") return clean(value, TRACKER_LIMITS.company);
  if (Array.isArray(value)) return organizationName(value[0]);
  if (isObject(value)) return clean(value.name, TRACKER_LIMITS.company);
  return null;
}

function placeText(value: Json | undefined): string | null {
  if (typeof value === "string") return clean(value, TRACKER_LIMITS.location);
  if (Array.isArray(value)) return placeText(value[0]);
  if (!isObject(value)) return null;
  const address = value.address;
  if (typeof address === "string") return clean(address, TRACKER_LIMITS.location);
  if (isObject(address)) {
    const country = isObject(address.addressCountry) ? address.addressCountry.name : address.addressCountry;
    const parts = [address.addressLocality, address.addressRegion, country]
      .map((part) => clean(part, TRACKER_LIMITS.location))
      .filter((part): part is string => Boolean(part));
    const unique = parts.filter((part, index) => parts.indexOf(part) === index);
    if (unique.length) return unique.join(", ").slice(0, TRACKER_LIMITS.location);
  }
  return clean(value.name, TRACKER_LIMITS.location);
}

function jobFromPosting(node: Record<string, Json>): PageJob | null {
  const jobTitle = clean(node.title, TRACKER_LIMITS.title) ?? clean(node.name, TRACKER_LIMITS.title);
  const companyName = organizationName(node.hiringOrganization);
  if (!jobTitle || !companyName) return null;
  const remote = typeof node.jobLocationType === "string" && /telecommute/i.test(node.jobLocationType);
  const place = placeText(node.jobLocation);
  const location = place && remote ? `${place} (Remote)`.slice(0, TRACKER_LIMITS.location) : (place ?? (remote ? "Remote" : null));
  return { jobTitle, companyName, location, description: cleanBlock(node.description, TRACKER_LIMITS.description) };
}

/** The first JobPosting in the page's `application/ld+json` scripts. */
export function jobFromJsonLd(html: string): PageJob | null {
  const scripts = html.matchAll(/<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi);
  for (const [, raw] of scripts) {
    let parsed: Json;
    try {
      parsed = JSON.parse(raw.trim()) as Json;
    } catch {
      continue;
    }
    for (const posting of findJobPostings(parsed)) {
      const job = jobFromPosting(posting);
      if (job) return job;
    }
  }
  return null;
}

function metaContent(html: string, key: string): string | null {
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    const name = tag.match(/\b(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1];
    if (name?.toLowerCase() !== key) continue;
    const content = tag.match(/\bcontent\s*=\s*"([^"]*)"/i)?.[1] ?? tag.match(/\bcontent\s*=\s*'([^']*)'/i)?.[1];
    if (content) return content;
  }
  return null;
}

/** Splits "Engineer at Acme", "Engineer - Acme" or "Acme | Engineer" when the company is one of the halves. */
function splitTitle(title: string, siteName: string | null): PageJob | null {
  const at = title.match(/^(.+?)\s+(?:at|@)\s+(.+?)(?:\s+[|\-–—]\s+.*)?$/i);
  if (at) {
    const jobTitle = clean(at[1], TRACKER_LIMITS.title);
    const companyName = clean(at[2], TRACKER_LIMITS.company);
    if (jobTitle && companyName) return { jobTitle, companyName, location: null };
  }
  const parts = title.split(/\s+[|\-–—]\s+/).map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2 && siteName) {
    const site = siteName.toLowerCase();
    const companyIndex = parts.findIndex((part) => part.toLowerCase() === site);
    if (companyIndex >= 0) {
      const rest = parts.filter((_, index) => index !== companyIndex);
      const jobTitle = clean(rest[0], TRACKER_LIMITS.title);
      const companyName = clean(parts[companyIndex], TRACKER_LIMITS.company);
      if (jobTitle && companyName) return { jobTitle, companyName, location: null };
    }
  }
  return null;
}

/** Sites whose og:site_name is the board, not the employer. */
const BOARD_SITE_NAMES = /^(linkedin|indeed|glassdoor|greenhouse|lever|ashby|workable|wellfound|angellist|rippling|naukri|monster)$/i;

/** og/twitter/title tags: a title plus a company, or nothing. */
export function jobFromMetaTags(html: string): PageJob | null {
  const ogTitle = metaContent(html, "og:title") ?? metaContent(html, "twitter:title");
  const titleTag = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? null;
  const rawSite = metaContent(html, "og:site_name");
  const siteName = rawSite ? clean(rawSite, TRACKER_LIMITS.company) : null;
  const employer = siteName && !BOARD_SITE_NAMES.test(siteName) ? siteName : null;

  for (const raw of [ogTitle, titleTag]) {
    const title = clean(raw, 500);
    if (!title) continue;
    const split = splitTitle(title, siteName);
    if (split && !BOARD_SITE_NAMES.test(split.companyName)) return split;
    if (employer && title.toLowerCase() !== employer.toLowerCase()) {
      return { jobTitle: title.slice(0, TRACKER_LIMITS.title), companyName: employer, location: null };
    }
  }
  return null;
}

/** The page's visible text, for the model fallback. */
export function pageText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(br|p|div|li|h[1-6]|tr|section|article)\b[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}
