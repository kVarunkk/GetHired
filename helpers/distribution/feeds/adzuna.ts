import { cdata, feedJobUrl, salaryText, stripInvalidXml, XML_DECLARATION, type FeedJob } from "./feed-job";

/**
 * Adzuna feed, plan/multiposting spec section 10.2 and Adzuna's XML
 * specification (June 2020). Pure. Outside the UK and US Adzuna doesn't
 * categorise ads itself, so the category matters for India.
 */

export const ADZUNA_COUNTRIES = [
  "AU", "AT", "BE", "BR", "CA", "CH", "FR", "DE", "ES", "IN", "IT", "MX", "NL", "NZ", "PL", "SG", "ZA", "UK", "US",
] as const;
export const ADZUNA_MIN_DESCRIPTION = 100;
const OTHER = 29;

/** First match wins. Keywords are matched against the job's department, then its title. */
const CATEGORY_RULES: [RegExp, number][] = [
  [/account|financ|audit|\btax/i, 1],
  [/sales|business development/i, 3],
  [/customer|call cent|service desk|\bbpo\b/i, 4],
  [/software|\bit\b|develop|programm|data|devops|\bsre\b|cloud|cyber|front-?end|back-?end|full[- ]?stack|android|\bios\b|\bweb\b|\bqa\b|tech|computer/i, 2],
  [/engineer/i, 5],
  [/\bhr\b|human resource|recruit|talent/i, 6],
  [/health|nurs|medic|clinic|pharma/i, 7],
  [/hospitality|catering|chef|hotel/i, 8],
  [/marketing|advertis|\bpr\b|public relations|brand|content|seo/i, 9],
  [/logistic|warehouse|supply chain|delivery/i, 10],
  [/teach|education|tutor|academic/i, 11],
  [/construction|trade|civil/i, 12],
  [/admin|office|secretar|operations/i, 13],
  [/legal|law|compliance/i, 14],
  [/design|creative|\bux\b|\bui\b/i, 15],
  [/graduate|fresher|trainee/i, 16],
  [/retail|store/i, 17],
  [/consult|strategy/i, 18],
  [/manufactur|production|plant/i, 19],
  [/scien|research|laborator|quality/i, 20],
  [/social work|community/i, 21],
  [/travel|tourism/i, 22],
  [/energy|oil|gas|power/i, 23],
  [/property|real estate/i, 24],
  [/charity|volunteer|non.?profit/i, 25],
  [/clean|domestic|housekeep/i, 26],
  [/maintenance|technician|repair/i, 27],
];

const INTERNSHIP_CATEGORY = 16;

/**
 * An Adzuna category id (1 to 29) from the job's department, else its title,
 * else Graduate Jobs for an internship, else Other.
 */
export function adzunaCategory(
  department: string | null | undefined,
  title?: string | null,
  jobType?: FeedJob["jobType"],
): number {
  for (const label of [department, title]) {
    const hit = label ? CATEGORY_RULES.find(([re]) => re.test(label)) : undefined;
    if (hit) return hit[1];
  }
  return jobType === "internship" ? INTERNSHIP_CATEGORY : OTHER;
}

/** Whether Adzuna would accept the job (supported country, long enough description). */
export function adzunaAccepts(job: FeedJob): boolean {
  const text = job.descriptionHtml.replace(/<[^>]*>/g, "").trim();
  return (
    (ADZUNA_COUNTRIES as readonly string[]).includes(job.countryCode.toUpperCase()) &&
    text.length >= ADZUNA_MIN_DESCRIPTION
  );
}

export function serializeAdzuna(jobs: FeedJob[], base?: string): string {
  const tag = (name: string, value: string | number | null | undefined) =>
    value != null && value !== "" ? `    <${name}>${cdata(stripInvalidXml(String(value)))}</${name}>` : null;

  const body = jobs.filter(adzunaAccepts).map((job) => {
    const remote = job.workplace === "remote";
    const sal = job.salary;
    const lines = [
      tag("id", job.id),
      tag("title", job.title),
      tag("description", job.descriptionHtml),
      tag("url", feedJobUrl(job.id, "adzuna", base)),
      tag("location", remote || !job.city ? job.country : job.city),
      tag("country", job.countryCode.toUpperCase()),
      tag("company", job.companyName),
      tag("category", adzunaCategory(job.category, job.title, job.jobType)),
      tag("date", job.postedAt.toISOString().slice(0, 10)),
      tag("salary", salaryText(sal)),
      sal ? tag("salary_min", sal.min) : null,
      sal ? tag("salary_max", sal.max) : null,
      sal && (sal.min != null || sal.max != null) ? tag("salary_frequency", "year") : null,
      sal && (sal.min != null || sal.max != null) ? tag("salary_currency", sal.currency) : null,
      // Adzuna knows permanent and contract only; an internship is fixed-term.
      tag("contract_type", job.jobType === "full_time" ? "permanent" : "contract"),
      tag("contract_time", "full_time"),
      tag("remote", remote ? 1 : 0),
    ].filter((l): l is string => l !== null);
    return `  <job>\n${lines.join("\n")}\n  </job>`;
  });

  return `${XML_DECLARATION}\n<jobs>\n${body.length ? body.join("\n") + "\n" : ""}</jobs>\n`;
}
