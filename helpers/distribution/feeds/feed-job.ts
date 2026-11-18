import { indianState, type LogoType } from "./normalize";

/** MP-REQ-004: the one internal shape every feed serializer reads. Pure, client-safe. */

export type FeedJobType = "full_time" | "contract" | "internship";
export type FeedWorkplace = "onsite" | "hybrid" | "remote";

export type FeedJob = {
  /** The `pid` in the url: the job's id. */
  id: string;
  title: string;
  /** HTML with the same content and order as the job page (`textToHtml`). */
  descriptionHtml: string;
  /** Closest town or city ("" when the job has no location), then its state when known, then country. */
  city: string;
  state: string | null;
  /** Every location the job lists, title-cased, in order (`city` is the first). */
  locations: string[];
  country: string;
  countryCode: string;
  workplace: FeedWorkplace;
  jobType: FeedJobType;
  companyName: string;
  companyLogoUrl: string | null;
  /** The city of the company's headquarters, for boards that need a place even for a remote job. */
  companyCity: string | null;
  /** From the logo's Content-Type; null when unknown, and then no feed sends it. */
  companyLogoType: LogoType | null;
  /** Yearly amounts (the form asks per annum). `currency` is ISO 4217; `text` is the stored range. */
  salary: { min: number | null; max: number | null; currency: string | null; text: string | null } | null;
  /** Experience in years. */
  experience: { min: number | null; max: number | null } | null;
  category: string | null;
  postedAt: Date;
  updatedAt: Date;
};

/** Escapes text for use outside CDATA. */
export function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
}

/** Wraps a value in CDATA, splitting any `]]>` inside it. */
export function cdata(value: string): string {
  return `<![CDATA[${value.replace(/]]>/g, "]]]]><![CDATA[>")}]]>`;
}

/** Characters XML 1.0 forbids would make the whole feed unreadable. */
export function stripInvalidXml(value: string): string {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "");
}

export const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>';

/** MP-REQ-005: the apply link, tagged with the channel and the posting. */
export function feedJobUrl(jobId: string, channel: string, base = "https://gethired.devhub.co.in"): string {
  const q = new URLSearchParams({ src: channel, pid: jobId });
  return `${base}/jobs/${jobId}?${q.toString()}`;
}

/** A salary as text, e.g. "INR 1000000 - 2000000 per year", for Jooble's and Adzuna's `salary`. */
export function salaryText(salary: FeedJob["salary"]): string | null {
  if (!salary) return null;
  const { min, max, currency } = salary;
  if (min == null && max == null) return salary.text;
  const range = min != null && max != null ? (min === max ? String(min) : `${min} - ${max}`) : min != null ? `${min}+` : `up to ${max}`;
  return `${currency ? `${currency} ` : ""}${range} per year`;
}

/**
 * The job's city and state, for boards that need both (Talent.com,
 * ZipRecruiter). A remote job with no location of its own uses the company's
 * headquarters. Null when no state is known.
 */
export function placeWithState(job: FeedJob): { city: string; state: string } | null {
  const own = job.city.trim();
  if (own) return job.state?.trim() ? { city: own, state: job.state.trim() } : null;
  if (job.workplace !== "remote" || !job.companyCity) return null;
  const state = indianState(job.companyCity);
  return state ? { city: job.companyCity, state } : null;
}
