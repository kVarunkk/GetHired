import * as React from "react";
import { BaseEmailLayout } from "@/emails/BaseEmailLayout";
import { Heading, Text, Section, Button, Link } from "@react-email/components";

export const RelevantJobsSetupUpdateEmail = ({
  userName,
  inviteUrl,
  insufficientCredits,
}: {
  userName: string;
  inviteUrl: string;
  insufficientCredits: boolean;
}) => {
  return (
    <BaseEmailLayout previewText={""}>
      <Heading className="text-2xl font-bold text-gray-800 my-6 ">
        {insufficientCredits
          ? `Hi, ${userName}, please top up your AI credits to access your AI Smart Search Job Feed!`
          : `Hi, ${userName}. Your latest AI Smart Search Job Feed is ready!`}
      </Heading>

      <Text className="text-base text-gray-700 mb-6 ">
        {insufficientCredits
          ? `We noticed that you have insufficient AI credits to access your AI Smart Search Job Feed. Please top up your AI credits. In the meantime, you can still explore jobs on our platform without AI personalization.`
          : `Follow the link below to view your personalized job feed.`}
      </Text>

      <Section className=" my-8 ">
        <Button
          href={
            insufficientCredits
              ? "https://gethired.devhub.co.in/dashboard"
              : inviteUrl
          }
          className="bg-black text-white py-3 px-6 rounded-md text-lg font-bold no-underline"
          style={{ backgroundColor: "#000000", color: "#FFFFFF" }}
        >
          {insufficientCredits ? "Top Up AI Credits" : "View Job Feed"}
        </Button>
      </Section>

      <Text className=" text-sm text-gray-500 mt-6 ">
        If the button above does not work, copy and paste this link into your
        browser:
        <br />
        <Link
          href={
            insufficientCredits
              ? "https://gethired.devhub.co.in/dashboard"
              : inviteUrl
          }
          className="text-blue-600 underline break-all"
        >
          {insufficientCredits
            ? "https://gethired.devhub.co.in/dashboard"
            : inviteUrl}
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

export default RelevantJobsSetupUpdateEmail;
