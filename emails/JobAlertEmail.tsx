import * as React from "react";
import { Button, Heading, Link, Section, Text } from "react-email";
import { BaseEmailLayout } from "@/emails/BaseEmailLayout";
import { truncateWords } from "@/helpers/job-alerts/name";
import { jobAlertJobUrl } from "@/helpers/job-alerts/paths";
import { formatDate } from "@/utils/date";

/** The job fields the email shows. */
export type JobAlertEmailJob = {
  id: string;
  job_name: string | null;
  company_name: string | null;
  locations: string[] | null;
  salary_range: string | null;
  created_at: string | null;
};

export type JobAlertEmailProps = {
  userName: string;
  alertId: string;
  alertName: string;
  frequency: "daily" | "weekly";
  /** Up to 10, newest first. */
  jobs: JobAlertEmailJob[];
  /** Every new job in the window, for "See all". */
  total: number;
  baseUrl: string;
  /** The alert's search, with `ref=job_alert`. */
  seeAllUrl: string;
  /** The one-click pause page (JA-REQ-036). */
  pauseUrl: string;
};

/** `"{N} new {alertName}"`, at most 70 characters (JA-REQ-035). */
export function jobAlertSubject(count: number, alertName: string): string {
  const name = alertName.startsWith("Jobs") ? `jobs${alertName.slice(4)}` : alertName;
  return truncateWords(`${count} new ${name}`, 70);
}

const listLocations = (locations: string[] | null) => {
  const list = [...new Set((locations ?? []).map((l) => l.trim()).filter(Boolean))];
  return truncateWords(list.join(", "), 60);
};

/** JA-REQ-035: the new jobs for one alert, with its pause link. */
export default function JobAlertEmail({
  userName,
  alertId,
  alertName,
  frequency,
  jobs,
  total,
  baseUrl,
  seeAllUrl,
  pauseUrl,
}: JobAlertEmailProps) {
  const settingsUrl = `${baseUrl}/settings#job-alerts`;
  return (
    <BaseEmailLayout previewText={jobAlertSubject(total, alertName)}>
      <Heading className="text-xl font-semibold text-gray-800 my-6 text-color">
        {`${total === 1 ? "1 new job" : `${total} new jobs`} for ${alertName}`}
      </Heading>
      <Text className="text-base text-gray-700 text-color">Hi {userName}, here&apos;s what was posted since your last alert.</Text>

      <Section className="mb-6">
        {jobs.map((job) => (
          <Section key={job.id} className="border border-solid border-gray-200 rounded-lg px-4 py-3 mb-3">
            <Link
              href={jobAlertJobUrl(baseUrl, job.id, alertId)}
              className="text-base font-semibold text-black no-underline"
            >
              {job.job_name}
            </Link>
            <Text className="text-sm text-gray-700 m-0 text-color">
              {[job.company_name, listLocations(job.locations)].filter(Boolean).join(" · ")}
            </Text>
            <Text className="text-xs text-gray-500 m-0 mt-1">
              {[job.salary_range, job.created_at ? `Posted ${formatDate(job.created_at)}` : null]
                .filter(Boolean)
                .join(" · ")}
            </Text>
          </Section>
        ))}
      </Section>

      {total > jobs.length && (
        <Button
          href={seeAllUrl}
          className="bg-black text-white link-color py-2 px-4 rounded-md text-sm font-semibold no-underline"
        >
          {`See all ${total} →`}
        </Button>
      )}

      <Text className="text-xs text-gray-500 mt-10">
        {`You get this ${frequency} because you created an alert for ${alertName}.`}
      </Text>
      <Text className="text-xs text-gray-500">
        <Link href={pauseUrl} className="text-gray-500 underline">
          Pause this alert
        </Link>
        {" · "}
        <Link href={settingsUrl} className="text-gray-500 underline">
          Change frequency
        </Link>
        {" · "}
        <Link href={settingsUrl} className="text-gray-500 underline">
          Manage all alerts
        </Link>
      </Text>
    </BaseEmailLayout>
  );
}
