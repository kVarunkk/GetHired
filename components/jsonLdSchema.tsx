"use client";

import { AllJobWithRelations } from "@/utils/types";

// import { IJob } from "@/utils/types";

interface JobSchemaProps {
  job: AllJobWithRelations;
}

export default function JobSchema({ job }: JobSchemaProps) {
  if (!job) return null;

  // 1. Determine job location type (Remote vs. On-Site)
  // Check if any location in the array contains 'remote' (case-insensitive)
  const isRemote = job.locations?.some((loc) =>
    loc.toLowerCase().includes("remote"),
  );

  // Determine if the job is fully remote or has mixed locations.
  // We'll mark it TELECOMMUTE if any location is 'remote'.

  // Define fallback values using non-null assertion or chaining for reliability
  // These keys match your IJob interface:
  const jobTitle =
    job.job_name || job.job_postings?.[0]?.title || "Job Opening";
  const jobDescription =
    job.description ||
    job.job_postings?.[0]?.description ||
    "A detailed job description.";
  const jobCompanyName = job.company_name || "Confidential Company";
  const jobCompanyUrl = job.company_url || "";
  const jobCreatedAt = job.created_at || new Date().toISOString();

  // Use a sensible default currency (e.g., USD or INR) if currency is not stored explicitly
  //   const salaryCurrency = "USD";

  // 2. Define Hiring Organization
  const hiringOrganization = {
    "@type": "Organization",
    name: jobCompanyName,
    // Ensure 'sameAs' is only included if jobCompanyUrl is valid
    ...(jobCompanyUrl && { sameAs: jobCompanyUrl }),
  };

  // 3. Define Job Location
  let jobLocationProps = {};

  if (isRemote) {
    // For remote jobs, use jobLocationType: TELECOMMUTE
    jobLocationProps = { jobLocationType: "TELECOMMUTE" };
  } else if (job.locations && job.locations.length > 0) {
    // For non-remote jobs, use the first location in the array
    jobLocationProps = {
      jobLocation: {
        "@type": "Place",
        address: {
          "@type": "PostalAddress",
          // Use the first location in the array for the primary address locality
          addressLocality: job.locations[0] || "Unknown City",
          addressCountry: "IN", // Update this based on your primary market
        },
      },
    };
  }

  // 4. Construct the main JobPosting object
  const schema = {
    "@context": "http://schema.org",
    "@type": "JobPosting",

    // --- CORE REQUIRED PROPERTIES ---
    title: jobTitle,
    description: jobDescription,
    datePosted: jobCreatedAt,
    validThrough: new Date(
      new Date(jobCreatedAt).setDate(new Date(jobCreatedAt).getDate() + 30),
    ).toISOString(), // Expires 30 days after posting

    employmentType: job.job_type || "FULL_TIME",
    hiringOrganization: hiringOrganization,

    // Set jobLocation or jobLocationType based on isRemote check
    ...jobLocationProps,

    // Optional: Salary Information (Ensuring min/max are numbers)
    ...(job.salary_min &&
      job.salary_max && {
        baseSalary: {
          "@type": "MonetaryAmount",
          currency: "$",
          value: {
            "@type": "QuantitativeValue",
            minValue: job.salary_min,
            maxValue: job.salary_max,
            unitText: "YEAR", // Assuming annual salary
          },
        },
      }),
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}
