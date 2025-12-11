import * as React from "react";
import { BaseEmailLayout } from "@/emails/BaseEmailLayout";
import {
  Heading,
  Text,
  Section,
  Button,
  Link,
  Row,
  Column,
} from "@react-email/components";
import { IJob } from "@/lib/types";

interface JobDigestEmailProps {
  userName: string;
  jobs: IJob[];
  //   digestDate: string;
}

const truncateString = (str: string, maxLength: number): string => {
  if (str.length > maxLength) {
    return str.substring(0, maxLength - 3) + "...";
  }
  return str;
};

export const JobDigestEmail = ({
  userName,
  jobs = [],
  //   digestDate,
}: JobDigestEmailProps) => {
  const mockJobs = [
    {
      id: "1",
      job_name: "Software Engineer",
      company_name: "Tech Corp",
      job_type: "Full-time",
      locations: [
        "DL",
        "IN / Delhi",
        "IN / Bengaluru",
        "KA",
        "IN / Bengaluru",
        "Karnataka",
        "IN / Gurugram",
        "HR",
        "IN / Gurugram",
        "Haryana",
        "IN",
      ],
      salary_range: "$80,000 - $120,000",
    },
  ];
  const jobsToDisplay = jobs.length > 0 ? jobs : mockJobs;

  return (
    <BaseEmailLayout previewText={""}>
      <Heading className="text-2xl font-bold text-gray-800 my-6 text-color">
        Hi {userName}, your weekly job matches are here!
      </Heading>

      <Text className="text-base text-gray-700 mb-6">
        Here are <strong>{jobsToDisplay.length} top jobs</strong> our AI found
        just for you this week, matching your skills, experience, and career
        goals.
      </Text>

      {/* --- Job List Section --- */}
      <Section className="mb-8">
        {jobsToDisplay.map((job) => (
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
              <Column>
                <Button
                  href={`https://gethired.devhub.co.in/jobs/${job.id}`}
                  className="bg-black text-white link-color py-2 px-4 rounded-md text-sm font-semibold no-underline"
                >
                  View Job & Apply
                </Button>
              </Column>
            </Row>
          </Section>
        ))}
      </Section>
      {/* --- End Job List Section --- */}

      <Text className="text-base text-gray-700 text-color mt-8">
        Didn't find what you were looking for?{" "}
        <Link
          href="https://gethired.devhub.co.in/get-started"
          className="text-blue-600 underline"
        >
          Adjust
        </Link>{" "}
        your profile preferences.
      </Text>

      <Text className="text-base text-gray-700 text-color mt-10">
        Best regards,
        <br />
        The GetHired Team
      </Text>
    </BaseEmailLayout>
  );
};

export default JobDigestEmail;
