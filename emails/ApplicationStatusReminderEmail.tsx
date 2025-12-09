import * as React from "react";
import { BaseEmailLayout } from "./BaseEmailLayout";
import {
  Heading,
  Text,
  Section,
  Button,
  Row,
  Column,
  Link,
} from "@react-email/components";
import { AppliedJob } from "@/app/api/updates/applicants/applications/route";

interface ApplicationStatusReminderEmailProps {
  userName: string;
  appliedJobs: AppliedJob[];
}

const truncateString = (str: string, maxLength: number): string => {
  if (str.length > maxLength) {
    return str.substring(0, maxLength - 3) + "...";
  }
  return str;
};

export const ApplicationStatusReminderEmail = ({
  userName,
  appliedJobs,
}: ApplicationStatusReminderEmailProps) => {
  return (
    <BaseEmailLayout previewText={""}>
      <Heading className="text-2xl font-bold text-gray-800 my-6 text-color">
        Hi {userName},
      </Heading>

      <Text className="text-base text-gray-700 mb-6 ">
        You applied to{" "}
        <strong>
          {appliedJobs.length} job{appliedJobs.length > 1 ? "s" : ""}
        </strong>{" "}
        last week, and now is a great time to check for updates! Following up
        promptly helps keep you top-of-mind with recruiters.
      </Text>

      {/* <Heading className="text-xl font-semibold mb-4 text-color">
        Jobs to Review
      </Heading> */}

      {/* List of Applied Jobs */}
      <Section className="mb-8">
        {appliedJobs.map((job) => (
          <Section
            key={job.id}
            className="border border-gray-200 rounded-lg  mb-4 shadow-sm"
          >
            {/* Job Title and Company Row */}
            <Row>
              <Column>
                <Link
                  href={`https://gethired.devhub.co.in/jobs/${job.id}`}
                  className="text-xl font-bold text-black no-underline"
                >
                  {job.job_name}
                </Link>
                <Text className="text-lg text-gray-800 mt-1 mb-2 text-color">
                  at {job.company_name}
                </Text>
              </Column>
            </Row>

            {/* Details Row */}
            <Row className="text-sm text-gray-600 mt-2 mb-4 text-color">
              {/* Column 1: Type - Add padding to the RIGHT */}
              <Column className="w-1/3" style={{ paddingRight: "15px" }}>
                <Text className="font-semibold m-0">Type:</Text>
                <Text className="m-0">{job.job_type}</Text>
              </Column>

              {/* Column 2: Location - Add padding to the RIGHT */}
              <Column
                className="w-1/3 truncate"
                style={{ paddingRight: "15px" }}
              >
                <Text className="font-semibold m-0">Location:</Text>
                <Text className="m-0 truncate">
                  {Array.isArray(job.locations)
                    ? truncateString(job.locations.join(", "), 40)
                    : job.locations}
                </Text>
              </Column>

              {/* Column 3: Salary - No extra padding needed */}
              <Column className="w-1/3">
                <Text className="font-semibold m-0">Salary:</Text>
                <Text className="m-0">{job.salary_range}</Text>
              </Column>
            </Row>

            {/* CTA Button Row */}
            <Row className="mt-4">
              {job.job_url ? (
                <Column>
                  <Button
                    href={job.job_url}
                    className="bg-black text-white link-color py-2 px-4 rounded-md text-sm font-semibold no-underline"
                  >
                    View Original Listing
                  </Button>
                </Column>
              ) : (
                ""
              )}
              <Column>
                <Button
                  href={`https://gethired.devhub.co.in/jobs/${job.id}`}
                  className="border border-black text-black bg-white link-color py-2 px-4 rounded-md text-sm font-semibold no-underline"
                >
                  View Job
                </Button>
              </Column>
            </Row>
          </Section>
        ))}
      </Section>

      {/* CTA Button */}
      <Section className="text-start my-16">
        <Button
          href="https://gethired.devhub.co.in/jobs?tab=applied&sortBy=created_at&sortOrder=desc"
          className="bg-black text-white link-color py-3 px-6 rounded-md text-lg font-bold no-underline"
        >
          View All Applied Jobs
        </Button>
      </Section>

      <Text className="text-base text-gray-700 mt-10 ">
        Best regards,
        <br />
        The GetHired Team
      </Text>
    </BaseEmailLayout>
  );
};
export default ApplicationStatusReminderEmail;
