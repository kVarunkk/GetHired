import * as React from "react";
import { Link, Section, Text } from "react-email";
import { BaseEmailLayout } from "./BaseEmailLayout";

export type WeeklyMatch = { firstName: string; matchScore: number | null; summary: string | null };
export type WeeklyMatchesJob = { title: string; url: string; newMatches: number; top: WeeklyMatch[] };

interface WeeklyMatchesEmailProps {
  companyName: string;
  jobs: WeeklyMatchesJob[];
  settingsUrl: string;
}

const plural = (n: number) => `${n} new matched candidate${n === 1 ? "" : "s"}`;

/**
 * Monday's matches (PL-REQ-010): per active job, how many candidates matched
 * this week and the top 3 with their match summaries. First names only, no
 * contact details. Opt-out link at the bottom.
 */
export default function WeeklyMatchesEmail({ companyName, jobs, settingsUrl }: WeeklyMatchesEmailProps) {
  const total = jobs.reduce((sum, job) => sum + job.newMatches, 0);
  const heading = `${plural(total)} this week for ${companyName}`;

  return (
    <BaseEmailLayout previewText={heading}>
      <Text className="text-xl font-semibold">{heading}</Text>
      {jobs.map((job) => (
        <Section key={job.url} className="mb-6">
          <Text className="mb-1 font-semibold">
            <Link href={job.url} className="text-blue-600 underline">
              {job.title}
            </Link>
            {` · ${plural(job.newMatches)}`}
          </Text>
          {job.top.map((m, i) => (
            <Text key={i} className="my-1 text-sm">
              {`${m.firstName}${m.matchScore === null ? "" : ` · match ${Math.round(m.matchScore)}`}` +
                (m.summary ? `: ${m.summary}` : "")}
            </Text>
          ))}
        </Section>
      ))}
      <Text className="text-xs text-gray-500">
        {"You get this email on Mondays. "}
        <Link href={settingsUrl} className="text-blue-600 underline">
          Turn it off
        </Link>
      </Text>
    </BaseEmailLayout>
  );
}
