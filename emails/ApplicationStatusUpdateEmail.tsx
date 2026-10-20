import * as React from "react";
import { BaseEmailLayout } from "./BaseEmailLayout"; // Assuming BaseEmailLayout is in the same directory
import { Heading, Text, Section, Button } from "react-email";

// Define the component props for strong typing
interface ApplicationStatusUpdateEmailProps {
  jobTitle: string;
  companyName: string;
  newStatus: string;
}

export const ApplicationStatusUpdateEmail = ({
  jobTitle,
  companyName,
  newStatus,
}: ApplicationStatusUpdateEmailProps) => {
  //   const previewText = `Update: Your application for ${jobTitle} at ${companyName} is now ${newStatus}.`;

  return (
    <BaseEmailLayout previewText="">
      <Heading className="text-2xl font-bold text-gray-800 my-6">
        Application Status Update
      </Heading>

      <Text className="text-base text-gray-700 mb-6">
        We're writing to let you know that there has been an update to your
        application for the <strong>{jobTitle}</strong> role at{" "}
        <strong>{companyName}</strong>.
      </Text>

      {/* Status Highlight Section */}
      <Section className="text-center my-8 bg-blue-50 py-4 border-l-4 border-blue-600 rounded-md">
        <Text className="text-base text-gray-600 m-0">
          Your new application status is:
        </Text>
        <Text className="text-2xl font-bold text-blue-600 m-0 mt-2 capitalize">
          {newStatus}
        </Text>
      </Section>

      <Text className="text-base text-gray-700 mb-6">
        To view the full details and track your application history, please
        visit your dashboard.
      </Text>

      {/* CTA Button */}
      <Section className="text-center my-8">
        <Button
          href={
            "https://gethired.devhub.co.in/jobs?tab=applied&sortBy=created_at&sortOrder=desc"
          }
          className="bg-black text-white py-3 px-6 rounded-md text-lg font-bold no-underline"
        >
          View My Applications
        </Button>
      </Section>

      <Text className="text-base text-gray-700 mt-10">
        Best regards,
        <br />
        The GetHired Team
      </Text>
    </BaseEmailLayout>
  );
};

export default ApplicationStatusUpdateEmail;
