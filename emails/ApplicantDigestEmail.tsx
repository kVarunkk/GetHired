import * as React from "react";
import { Link, Section, Text } from "react-email";
import { BaseEmailLayout } from "./BaseEmailLayout";

export type DigestApplicant = { name: string; fitScore: number | null };
export type DigestJob = { title: string; url: string; applicants: DigestApplicant[] };

interface ApplicantDigestEmailProps {
  companyName: string;
  /** `daily`: yesterday's digest; `instant`: a new-applicant alert. */
  kind: "daily" | "instant";
  jobs: DigestJob[];
  settingsUrl: string;
}

const count = (n: number) => `${n} new applicant${n === 1 ? "" : "s"}`;

/**
 * New applicants per job, with their fit scores and a link to each job page
 * (PL-REQ-009). Names only: no contact details.
 */
export default function ApplicantDigestEmail({ companyName, kind, jobs, settingsUrl }: ApplicantDigestEmailProps) {
  const total = jobs.reduce((sum, job) => sum + job.applicants.length, 0);
  const heading = kind === "daily" ? `${count(total)} for ${companyName}` : `${count(total)} for ${jobs[0]?.title}`;

  return (
    <BaseEmailLayout previewText="">
      <Text className="text-xl font-semibold">{heading}</Text>
      {jobs.map((job) => (
        <Section key={job.url} className="mb-6">
          <Text className="mb-1 font-semibold">
            <Link href={job.url} className="text-blue-600 underline">
              {job.title}
            </Link>
            {` · ${count(job.applicants.length)}`}
          </Text>
          {job.applicants.map((a, i) => (
            <Text key={i} className="my-0 text-sm">
              {`${a.name} · ${a.fitScore === null ? "fit score pending" : `fit score ${a.fitScore}`}`}
            </Text>
          ))}
        </Section>
      ))}
      <Text className="text-xs text-gray-500">
        {kind === "daily" ? "You get this digest daily. " : "You get these alerts as people apply. "}
        <Link href={settingsUrl} className="text-blue-600 underline">
          Change how often
        </Link>
      </Text>
    </BaseEmailLayout>
  );
}
