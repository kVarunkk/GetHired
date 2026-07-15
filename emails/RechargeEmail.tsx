import * as React from "react";
import { BaseEmailLayout } from "@/emails/BaseEmailLayout";
import { Heading, Text, Section, Button, Link } from "@react-email/components";

export const RechargeEmail = ({ userName }: { userName: string }) => {
  return (
    <BaseEmailLayout previewText={""}>
      <Heading className="text-2xl font-bold text-gray-800 my-6 ">
        Important: Keep your AI-powered job hunt moving, {userName}!
      </Heading>

      <Text className="text-base text-gray-700 mb-6 ">
        We noticed that you have insufficient AI credits to access your{" "}
        <b>AI Smart Search Job Feed</b> and <b>Daily Job Digest</b>. Please top
        up your AI credits. In the meantime, you can still explore jobs on our
        platform without AI personalization.
      </Text>

      <Section className=" my-8 ">
        <Button
          href={"https://gethired.devhub.co.in/dashboard/buy-credits"}
          className="bg-black text-white py-3 px-6 rounded-md text-lg font-bold no-underline"
          style={{ backgroundColor: "#000000", color: "#FFFFFF" }}
        >
          {"Resume AI Job Hunt"}
        </Button>
      </Section>

      <Text className=" text-sm text-gray-500 mt-6 ">
        If the button above does not work, copy and paste this link into your
        browser:
        <br />
        <Link
          href={"https://gethired.devhub.co.in/dashboard/buy-credits"}
          className="text-blue-600 underline break-all"
        >
          {"https://gethired.devhub.co.in/dashboard/buy-credits"}
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

export default RechargeEmail;
