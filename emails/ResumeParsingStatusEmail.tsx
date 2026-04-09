import * as React from "react";
import { BaseEmailLayout } from "./BaseEmailLayout";
import { Heading, Text, Section, Button } from "@react-email/components";

interface ResumeParsingStatusEmailProps {
  resumeName: string;
  status: "success" | "failure";
  resumeLink: string;
}

export const ResumeParsingStatusEmail = ({
  resumeName,
  status,
  resumeLink,
}: ResumeParsingStatusEmailProps) => {
  const isSuccess = status === "success";

  return (
    <BaseEmailLayout previewText={""}>
      <Heading className="text-2xl font-bold text-gray-800 my-6">
        {isSuccess ? "Resume Indexing Complete" : "Resume Parsing Update"}
      </Heading>

      <Text className="text-base text-gray-700 mb-6">
        {isSuccess ? (
          <>
            We've successfully finished building the digital twin for{" "}
            <strong>{resumeName}</strong>. Our AI has mapped your experience and
            you can now start tailoring it for specific roles.
          </>
        ) : (
          <>
            We encountered an issue while trying to extract text from{" "}
            <strong>{resumeName}</strong>. This usually happens with scanned
            documents or complex multi-column layouts.
          </>
        )}
      </Text>

      {/* Status Highlight Section - Blue Theme */}
      <Section className="text-center my-8 bg-blue-50 py-4 border-l-4 border-blue-600 rounded-md">
        <Text className="text-base text-gray-600 m-0">
          The indexing status is:
        </Text>
        <Text className="text-2xl font-bold text-blue-600 m-0 mt-2 capitalize">
          {isSuccess ? "Successfully Parsed" : "Parsing Failed"}
        </Text>
      </Section>

      <Text className="text-base text-gray-700 mb-6">
        {isSuccess
          ? "You can now view the interactive mirror of your document and run AI analysis against any job description."
          : "Please visit your dashboard to retry the synchronization or upload a different version of your resume."}
      </Text>

      {/* CTA Button */}
      <Section className="text-center my-8">
        <Button
          href={resumeLink}
          className="bg-black text-white py-3 px-6 rounded-md text-lg font-bold no-underline"
        >
          {isSuccess ? "View Digital Twin" : "Retry Synchronization"}
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

export default ResumeParsingStatusEmail;
