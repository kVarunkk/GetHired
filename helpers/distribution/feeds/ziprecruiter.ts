import { cdata, feedJobUrl, placeWithState, stripInvalidXml, XML_DECLARATION, type FeedJob, type FeedJobType } from "./feed-job";

/**
 * ZipRecruiter feed, their "XML Feed Documentation" v1.9 (2025-10). Pure.
 * - The feed is the full list of open jobs; a job left out is closed on their
 *   side, so a closed or opted-out job just drops out of the next build.
 * - Candidate delivery is `<url>` only: applicants go to the job page, and a
 *   feed never carries contact details, so no `<email>`.
 * - `city` needs `state` (`placeWithState`); there's no postal code to send instead.
 * - Compensation only in USD, CAD or AUD, the currencies they accept.
 * Not sent: `benefits`, `education`, `postalcode`, `address` (no data),
 * `interview_json` (screening questions and knockout rules never leave
 * GetHired), `partner_attributes`, `resume_not_required`.
 */

/** `referencenumber` longer than this is rejected. */
export const ZIPRECRUITER_MAX_REFERENCE = 64;

/** Their list: Full-Time, Part-Time, Contractor, Temporary, Per Diem, Other. */
const JOB_TYPES: Record<FeedJobType, string> = {
  full_time: "Full-Time",
  contract: "Contractor",
  internship: "Other",
};

export const ZIPRECRUITER_CURRENCIES = ["USD", "CAD", "AUD"] as const;

/** `2016-07-31T07:27:14`, ISO 8601 in UTC with no milliseconds. */
const zipDate = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");

/**
 * Their levels: intern, entry (0-2 years), mid (3-6), senior (7+). Read from
 * the minimum years, else the maximum. Null when the job gives neither.
 */
export function zipExperience(job: Pick<FeedJob, "jobType" | "experience">): string | null {
  if (job.jobType === "internship") return "intern";
  const years = job.experience?.min ?? job.experience?.max;
  if (years == null) return null;
  return years <= 2 ? "entry" : years <= 6 ? "mid" : "senior";
}

/** Whether ZipRecruiter would take the job: a description, a city with its state, and a short enough id. */
export function ziprecruiterAccepts(job: FeedJob): boolean {
  return (
    job.id.length <= ZIPRECRUITER_MAX_REFERENCE &&
    job.descriptionHtml.replace(/<[^>]*>/g, "").trim().length > 0 &&
    placeWithState(job) !== null
  );
}

export function serializeZipRecruiter(jobs: FeedJob[], builtAt: Date = new Date(), base?: string): string {
  const tag = (name: string, v: string | number | null | undefined, indent = "    ") =>
    v != null && v !== "" ? `${indent}<${name}>${cdata(stripInvalidXml(String(v)))}</${name}>` : null;

  const body = jobs.filter(ziprecruiterAccepts).map((job) => {
    const place = placeWithState(job)!;
    const sal = job.salary;
    const currency = sal?.currency?.toUpperCase() ?? null;
    const hasPay =
      !!sal &&
      (sal.min != null || sal.max != null) &&
      !!currency &&
      (ZIPRECRUITER_CURRENCIES as readonly string[]).includes(currency);
    // compensation_min must not be above compensation_max.
    const [payMin, payMax] =
      hasPay && sal!.min != null && sal!.max != null && sal!.min > sal!.max ? [sal!.max, sal!.min] : [sal?.min, sal?.max];
    const lines = [
      tag("referencenumber", job.id),
      tag("title", job.title),
      tag("description", job.descriptionHtml),
      tag("country", job.countryCode.toUpperCase()),
      tag("city", place.city),
      tag("state", place.state),
      tag("company", job.companyName),
      tag("date", zipDate(job.postedAt)),
      tag("url", feedJobUrl(job.id, "ziprecruiter", base)),
      tag("accept_remote", job.workplace === "remote" ? 1 : 0),
      tag("jobtype", JOB_TYPES[job.jobType]),
      tag("experience", zipExperience(job)),
      hasPay ? tag("compensation_interval", "Annually") : null,
      hasPay ? tag("compensation_min", payMin) : null,
      hasPay ? tag("compensation_max", payMax) : null,
      hasPay ? tag("compensation_currency", currency) : null,
    ].filter((l): l is string => l !== null);
    return `  <job>\n${lines.join("\n")}\n  </job>`;
  });

  const header = [
    `  <lastBuildDate>${cdata(builtAt.toUTCString())}</lastBuildDate>`,
    `  <publisherurl>${cdata("https://gethired.devhub.co.in")}</publisherurl>`,
    `  <publisher>${cdata("GetHired")}</publisher>`,
  ];
  return `${XML_DECLARATION}\n<source>\n${header.join("\n")}\n${body.length ? body.join("\n") + "\n" : ""}</source>\n`;
}
