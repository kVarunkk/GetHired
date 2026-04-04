import * as React from "react";
import { BaseEmailLayout } from "./BaseEmailLayout";
import { Heading, Text, Section, Button } from "@react-email/components";

interface ResumeReviewStatusEmailProps {
  reviewName: string;
  status: "success" | "failure";
  reviewLink: string;
}

export const ResumeReviewStatusEmail = ({
  reviewName,
  status,
  reviewLink,
}: ResumeReviewStatusEmailProps) => {
  const isSuccess = status === "success";

  return (
    <BaseEmailLayout previewText={""}>
      <Heading className="text-2xl font-bold text-gray-800 my-6">
        {isSuccess ? "Resume Indexing Complete" : "Resume Parsing Update"}
      </Heading>

      <Text className="text-base text-gray-700 mb-6">
        {isSuccess ? (
          <>
            Your AI-powered resume review for <strong>{reviewName}</strong> is
            complete. We've analyzed your experience against the target role to
            identify high-impact optimization opportunities.
          </>
        ) : (
          <>
            We encountered an issue while generating the tailored review for{" "}
            <strong>{reviewName}</strong>. This can occasionally happen due to
            processing timeouts or complex document formatting.
          </>
        )}
      </Text>

      {/* Status Highlight Section - Blue Theme */}
      <Section className="text-center my-8 bg-blue-50 py-4 border-l-4 border-blue-600 rounded-md">
        <Text className="text-base text-gray-600 m-0">
          The analysis status is:
        </Text>
        <Text className="text-2xl font-bold text-blue-600 m-0 mt-2 capitalize">
          {isSuccess ? "Successfully Analysed" : "Analysis Failed"}
        </Text>
      </Section>

      <Text className="text-base text-gray-700 mb-6">
        {isSuccess
          ? "You can now view your personalized suggestions, including metric-driven bullet points and a detailed match score."
          : "Please head back to your workspace to restart the analysis. Rest assured, no credits were deducted for this attempt."}
      </Text>

      {/* CTA Button */}
      <Section className="text-center my-8">
        <Button
          href={reviewLink}
          className="bg-black text-white py-3 px-6 rounded-md text-lg font-bold no-underline"
        >
          {isSuccess ? "View Resume Review" : "Retry Analysis"}
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

export default ResumeReviewStatusEmail;
