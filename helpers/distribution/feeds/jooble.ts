import { cdata, escapeXml, feedJobUrl, salaryText, stripInvalidXml, XML_DECLARATION, type FeedJobType, type FeedJob } from "./feed-job";
import type { LogoType } from "./normalize";

/**
 * Jooble feed, plan/multiposting spec section 10.1 and Jooble's XML Feed
 * Specifications. Pure. `expire` is the job's closing date, when it has one
 * (JL-REQ-016). Not sent: `email`
 * (applications come through the job page; feeds never carry contact details)
 * and the paid tags (`paid`, `cpc`, `budget`).
 */

const JOB_TYPES: Record<FeedJobType, string> = {
  full_time: "full-time",
  contract: "contract",
  internship: "internship",
};

/** Jooble wants `DD.MM.YYYY`. */
export function joobleDate(date: Date): string {
  const d = String(date.getUTCDate()).padStart(2, "0");
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${d}.${m}.${date.getUTCFullYear()}`;
}

/** Jooble takes JPG, PNG or GIF logos. */
const LOGO_TYPES: readonly LogoType[] = ["jpeg", "png", "gif"];

export function serializeJooble(jobs: FeedJob[], base?: string): string {
  const tag = (name: string, value: string | null | undefined) =>
    value ? `    <${name}>${cdata(stripInvalidXml(value))}</${name}>` : null;

  const body = jobs.map((job) => {
    // "List of regions/cities ... separated by any punctuation marks": every location, then the country.
    const places = job.workplace === "remote" ? [] : job.locations.length ? job.locations : [job.city];
    const region = [...places, job.country].filter(Boolean).join(", ");
    const salary = salaryText(job.salary);
    const lines = [
      tag("link", feedJobUrl(job.id, "jooble", base)),
      tag("name", job.title),
      tag("region", region),
      tag("description", job.descriptionHtml),
      tag("pubdate", joobleDate(job.postedAt)),
      tag("updated", joobleDate(job.updatedAt)),
      tag("expire", job.closesOn ? joobleDate(new Date(`${job.closesOn}T00:00:00Z`)) : null),
      tag("salary", salary),
      tag("company", job.companyName),
      tag("jobtype", JOB_TYPES[job.jobType]),
      tag("company_logo", job.companyLogoType && LOGO_TYPES.includes(job.companyLogoType) ? job.companyLogoUrl : null),
    ].filter((l): l is string => l !== null);
    return `  <job id="${escapeXml(job.id)}">\n${lines.join("\n")}\n  </job>`;
  });

  return `${XML_DECLARATION}\n<jobs>\n${body.length ? body.join("\n") + "\n" : ""}</jobs>\n`;
}
