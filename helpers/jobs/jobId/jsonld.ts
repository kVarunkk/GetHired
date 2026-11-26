import { toIsoCurrency } from "@/helpers/currency/currencies";
import { TJobIdPageData } from "@/utils/types/jobs.types";
import { endOfDayIn } from "@/helpers/companies/time-zone";

/** A company job's closing date (`YYYY-MM-DD`), or null; scraped jobs have none. */
export function jobClosingDate(job: TJobIdPageData): string | null {
  return job?.job_postings?.[0]?.closes_at ?? null;
}

/**
 * JL-REQ-016: when the job stops taking applications, the end of its closing
 * date in the company's time zone, or undefined without one.
 */
export function jobValidThrough(job: TJobIdPageData): string | undefined {
  const closesAt = jobClosingDate(job);
  if (!closesAt) return undefined;
  return endOfDayIn(closesAt, job?.job_postings?.[0]?.company_info?.time_zone) ?? undefined;
}

function toISODate(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const d = new Date(value); // JS Date parses "YYYY-MM-DD HH:mm:ss.ssssss+00" fine in Node
  if (isNaN(d.getTime())) return undefined;
  return d.toISOString(); // -> "2026-07-20T16:49:19.334Z"
}

function stripHtml(value?: string | null) {
  if (!value) return "";
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeEmploymentType(jobType?: string | null) {
  const normalized = (jobType || "").toLowerCase();

  if (normalized.includes("full") || normalized.includes("fulltime")) {
    return "FULL_TIME";
  }

  if (normalized.includes("part")) {
    return "PART_TIME";
  }

  if (normalized.includes("intern")) {
    return "INTERN";
  }

  if (normalized.includes("contract")) {
    return "CONTRACTOR";
  }

  if (normalized.includes("temp")) {
    return "TEMPORARY";
  }

  return undefined;
}

function isRemoteLikeLocation(location?: string | null) {
  const normalized = (location || "").toLowerCase();

  return (
    normalized.includes("remote") ||
    normalized.includes("telecommute") ||
    normalized.includes("anywhere") ||
    normalized.includes("worldwide")
  );
}

function isRemoteLocation(locations?: string[] | null) {
  if (!Array.isArray(locations)) return false;

  return locations.some((location) => isRemoteLikeLocation(location));
}

function isWorldwideRemoteLocation(locations?: string[] | null) {
  if (!Array.isArray(locations)) return false;

  return locations.some((location) => {
    const normalized = (location || "").toLowerCase();
    return normalized.includes("anywhere") || normalized.includes("worldwide");
  });
}

function getApplicantLocationRequirement(locations?: string[] | null) {
  if (!Array.isArray(locations)) return undefined;

  if (isWorldwideRemoteLocation(locations)) {
    return {
      "@type": "Country",
      name: "Worldwide",
    };
  }

  return undefined;
}

function getSalaryUnit(salaryRange?: string | null) {
  if (!salaryRange) return undefined;

  const normalized = salaryRange.toLowerCase();
  if (/\b(hourly|per\s+hour|\/\s*hour|\/\s*hr)\b/.test(normalized)) {
    return "HOUR";
  }
  if (/\b(daily|per\s+day|\/\s*day)\b/.test(normalized)) {
    return "DAY";
  }
  if (/\b(weekly|per\s+week|\/\s*week)\b/.test(normalized)) {
    return "WEEK";
  }
  if (/\b(monthly|per\s+month|\/\s*month)\b/.test(normalized)) {
    return "MONTH";
  }
  if (
    /\b(annual(?:ly)?|per\s+year|\/\s*year|per\s+annum|lpa)\b/.test(
      normalized,
    )
  ) {
    return "YEAR";
  }

  return undefined;
}

function getSalaryCurrency(salaryRange?: string | null) {
  if (!salaryRange) return undefined;

  const normalized = salaryRange.trim();

  if (
    normalized.includes("₹") ||
    /\bINR\b/i.test(normalized) ||
    /\bRs\.?\b/i.test(normalized)
  ) {
    return "INR";
  }

  if (
    normalized.includes("$") ||
    /\bUSD\b/i.test(normalized) ||
    /\bUS\$\b/i.test(normalized)
  ) {
    return "USD";
  }

  if (normalized.includes("€") || /\bEUR\b/i.test(normalized)) {
    return "EUR";
  }

  if (normalized.includes("£") || /\bGBP\b/i.test(normalized)) {
    return "GBP";
  }

  if (normalized.includes("A$") || /\bAUD\b/i.test(normalized)) {
    return "AUD";
  }

  if (normalized.includes("C$") || /\bCAD\b/i.test(normalized)) {
    return "CAD";
  }

  if (normalized.includes("¥") || /\bJPY\b/i.test(normalized)) {
    return "JPY";
  }

  if (normalized.includes("S$") || /\bSGD\b/i.test(normalized)) {
    return "SGD";
  }

  return undefined;
}

/** A link-only company job (JL-REQ-025): reachable by link, never indexed. */
export function isLinkOnlyJob(job: TJobIdPageData): boolean {
  return job?.job_postings?.[0]?.visibility === "link_only";
}

export function buildJobPostingJsonLd(job: TJobIdPageData) {
  // No structured data for a job that must stay out of search results.
  if (isLinkOnlyJob(job)) return null;
  const title = job?.job_name?.trim() || "Job Opening";
  const description = stripHtml(job?.description || job?.ai_summary || "");
  const companyName = job?.company_name?.trim() || "Confidential Company";
  const datePosted = toISODate(job?.created_at);
  // const companyUrl = job?.company_url?.trim();
  const locations = Array.isArray(job?.normalized_locations)
    ? job.normalized_locations.filter((loc): loc is string =>
        Boolean(loc && loc.trim()),
      )
    : [];
  const isRemote = isRemoteLocation(locations);
  const employmentType = normalizeEmploymentType(job?.job_type);

  if (!description || !companyName) return null;

  const jsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title,
    description,
    hiringOrganization: {
      "@type": "Organization",
      name: companyName,
      // ...(companyUrl ? { sameAs: companyUrl } : {}),
    },
    identifier: {
      "@type": "PropertyValue",
      name: companyName,
      value: String(job?.id ?? ""),
    },
    ...(datePosted ? { datePosted } : {}),
    ...(employmentType ? { employmentType } : {}),
    ...{
      url: `https://gethired.devhub.co.in/jobs/${job.id}`,
      directApply: true,
    },
  };

  // JL-REQ-011: a company job's openings (scraped jobs have no posting).
  const openings = job?.job_postings?.[0]?.openings;
  if (typeof openings === "number" && openings >= 1) {
    jsonLd.totalJobOpenings = openings;
  }

  const validThrough = jobValidThrough(job);
  if (validThrough) jsonLd.validThrough = validThrough;

  if (isRemote) {
    jsonLd.jobLocationType = "TELECOMMUTE";

    const applicantLocationRequirement =
      getApplicantLocationRequirement(locations);
    if (applicantLocationRequirement) {
      jsonLd.applicantLocationRequirements = applicantLocationRequirement;
    }
  } else if (locations.length > 0) {
    const [primaryLocation] = locations;
    jsonLd.jobLocation = {
      "@type": "Place",
      address: {
        "@type": "PostalAddress",
        addressLocality: primaryLocation,
      },
    };
  }

  const salaryCurrency =
    toIsoCurrency(job?.salary_currency) ??
    getSalaryCurrency(job?.salary_range);
  const salaryUnit = getSalaryUnit(job?.salary_range);

  if (job?.salary_min != null || job?.salary_max != null) {
    const minSalary =
      typeof job.salary_min === "number" ? job.salary_min : undefined;
    const maxSalary =
      typeof job.salary_max === "number" ? job.salary_max : undefined;

    if (salaryCurrency && salaryUnit) {
      jsonLd.baseSalary = {
        "@type": "MonetaryAmount",
        currency: salaryCurrency,
        value: {
          "@type": "QuantitativeValue",
          ...(minSalary != null ? { minValue: minSalary } : {}),
          ...(maxSalary != null ? { maxValue: maxSalary } : {}),
          unitText: salaryUnit,
        },
      };
    }
  }

  return jsonLd;
}
