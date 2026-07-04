import * as React from "react";
import { BaseEmailLayout } from "@/emails/BaseEmailLayout";
import { Heading, Text, Section, Button, Link } from "@react-email/components";

export const RelevantProfilesUpdateEmail = ({
  userName,
  inviteUrl,
  status,
  jobName,
  error,
}: {
  userName: string;
  inviteUrl: string;
  status: "success" | "failure";
  jobName: string;
  error?: string;
}) => {
  const isSuccess = status === "success";

  return (
    <BaseEmailLayout previewText={""}>
      {/* --- Dynamic Heading --- */}
      <Heading className="text-2xl font-bold text-gray-800 my-6 ">
        {isSuccess
          ? `Hi, ${userName}. Your latest AI Smart Search Profile Feed for ${jobName} is ready!`
          : `Hi, ${userName}. We encountered an issue updating your AI Smart Search for ${jobName}.`}
      </Heading>

      {/* --- Dynamic Body Text --- */}
      <Text className="text-base text-gray-700 mb-6 ">
        {isSuccess
          ? "Our AI engine has successfully discovered and ranked the most suitable candidate profiles matching your job requirements. Follow the link below to view your personalized profile feed."
          : "We weren't able to generate highly relevant profile matches with your current search criteria. This can happen if the role constraints are too narrow. Click below to review your search settings and try again."}
      </Text>

      {error && (
        <Text className="text-base mb-6 text-gray-700 font-bold">
          Error: {error}
        </Text>
      )}

      {/* --- Dynamic Action Button --- */}
      <Section className=" my-8 ">
        <Button
          href={inviteUrl}
          className="bg-black text-white py-3 px-6 rounded-md text-lg font-bold no-underline"
          style={{ backgroundColor: "#000000", color: "#FFFFFF" }}
        >
          {isSuccess ? "View Profile Feed" : "Manage Search Settings"}
        </Button>
      </Section>

      {/* --- Fallback Link --- */}
      <Text className=" text-sm text-gray-500 mt-6 ">
        If the button above does not work, copy and paste this link into your
        browser:
        <br />
        <Link href={inviteUrl} className="text-blue-600 underline break-all">
          {inviteUrl}
        </Link>
      </Text>

      <Text className="text-base text-gray-700 mt-10 ">
        Best regards,
        <br />
        The GetHired Team
      </Text>
    </BaseEmailLayout>
  );
};

export default RelevantProfilesUpdateEmail;
