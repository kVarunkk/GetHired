import * as React from "react";
import { BaseEmailLayout } from "@/emails/BaseEmailLayout";
import { Heading, Text, Section, Button, Link } from "@react-email/components";

export const RelevantJobsSetupUpdateEmail = ({
  userName,
  inviteUrl,
}: {
  userName: string;
  inviteUrl: string;
}) => {
  return (
    <BaseEmailLayout previewText={""}>
      <Heading className="text-2xl font-bold text-gray-800 my-6 ">
        Hi, {userName}. Your latest AI Smart Search Job Feed is ready!
      </Heading>

      <Text className="text-base text-gray-700 mb-6 ">
        Follow the link below to view your personalized job feed.
      </Text>

      <Section className=" my-8 ">
        <Button
          href={inviteUrl}
          className="bg-black text-white py-3 px-6 rounded-md text-lg font-bold no-underline"
          style={{ backgroundColor: "#000000", color: "#FFFFFF" }}
        >
          View Feed
        </Button>
      </Section>

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

export default RelevantJobsSetupUpdateEmail;
