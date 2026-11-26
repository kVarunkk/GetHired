import { cdata, feedJobUrl, placeWithState, stripInvalidXml, XML_DECLARATION, type FeedJob, type FeedJobType } from "./feed-job";
import { talentCategory } from "./normalize";

/**
 * Talent.com feed, plan/multiposting spec section 10.3 and their XML guide
 * (talent.com/integrations). Pure. `expirationdate` is the end of the job's
 * closing date, when it has one (JL-REQ-016); a closed job also drops out of
 * the next build. Not sent: `cpc`, since paid placement is out of scope.
 *
 * `city` and `state` are required with no exception for remote jobs
 * (`placeWithState`).
 */

export const TALENT_MIN_DESCRIPTION = 50;

/** The guide's examples: "Full time", "part-time". */
const JOB_TYPES: Record<FeedJobType, string> = {
  full_time: "Full time",
  contract: "Contract",
  internship: "Internship",
};

/** `yyyy-MM-ddTHH:mm:ssZ`, no milliseconds. */
const talentDate = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");

/** Whether Talent.com would take the job: a description of at least 50 characters, a city and a state. */
export function talentAccepts(job: FeedJob): boolean {
  return job.descriptionHtml.replace(/<[^>]*>/g, "").trim().length >= TALENT_MIN_DESCRIPTION && placeWithState(job) !== null;
}

export type TalentFeedOptions = {
  base?: string;
  /** Talent Apply's `posturl` for a job; Talent Apply is off when absent. */
  applyPostUrl?: (jobId: string) => string;
};

export function serializeTalent(jobs: FeedJob[], builtAt: Date = new Date(), options: TalentFeedOptions = {}): string {
  const value = (v: string | number | null | undefined) =>
    v != null && v !== "" ? cdata(stripInvalidXml(String(v))) : null;
  const tag = (name: string, v: string | number | null | undefined, indent = "    ") => {
    const content = value(v);
    return content ? `${indent}<${name}>${content}</${name}>` : null;
  };
  const block = (name: string, lines: (string | null)[]) => {
    const kept = lines.filter((l): l is string => l !== null);
    return kept.length ? `    <${name}>\n${kept.join("\n")}\n    </${name}>` : null;
  };

  const body = jobs.filter(talentAccepts).map((job) => {
    const place = placeWithState(job)!;
    const url = `${feedJobUrl(job.id, "talent", options.base)}&source=talent`;
    const sal = job.salary;
    const exp = job.experience;
    const hasPay = !!sal && (sal.min != null || sal.max != null) && !!sal.currency;
    const hasExp = !!exp && (exp.min != null || exp.max != null);
    const applyData = options.applyPostUrl
      ? new URLSearchParams({ "talent-apply-posturl": options.applyPostUrl(job.id) }).toString()
      : null;
    const lines = [
      tag("referencenumber", job.id),
      tag("title", job.title),
      tag("company", job.companyName),
      tag("city", place.city),
      tag("state", place.state),
      tag("country", job.country),
      tag("dateposted", talentDate(job.postedAt)),
      tag("expirationdate", job.expiresAt ? talentDate(job.expiresAt) : null),
      tag("url", url),
      tag("description", job.descriptionHtml),
      tag("jobtype", JOB_TYPES[job.jobType]),
      tag("isremote", job.workplace === "remote" ? "yes" : "no"),
      tag("category", talentCategory(job.category, job.title)),
      tag("logo", job.companyLogoType === "png" ? job.companyLogoUrl : null),
      hasExp
        ? block("experience", [
            tag("experience_max", exp!.max, "      "),
            tag("experience_min", exp!.min, "      "),
            tag("period", "year", "      "),
          ])
        : null,
      hasPay
        ? block("salary", [
            tag("salary_max", sal!.max, "      "),
            tag("salary_min", sal!.min, "      "),
            tag("salary_currency", sal!.currency, "      "),
            tag("period", "year", "      "),
            tag("type", "BASE_SALARY", "      "),
          ])
        : null,
      tag("talent-apply-data", applyData),
    ].filter((l): l is string => l !== null);
    return `  <job>\n${lines.join("\n")}\n  </job>`;
  });

  const header = [
    `  <publisher>${cdata("GetHired")}</publisher>`,
    `  <publisherurl>${cdata("https://gethired.devhub.co.in")}</publisherurl>`,
    `  <lastbuilddate>${cdata(talentDate(builtAt))}</lastbuilddate>`,
  ];
  return `${XML_DECLARATION}\n<source>\n${header.join("\n")}\n${body.length ? body.join("\n") + "\n" : ""}</source>\n`;
}
