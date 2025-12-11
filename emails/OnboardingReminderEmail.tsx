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

interface OnboardingReminderEmailProps {
  userName: string;
}

export const OnboardingReminderEmail = ({
  userName,
}: OnboardingReminderEmailProps) => {
  return (
    <BaseEmailLayout previewText={""}>
      <Heading className="text-2xl font-bold text-gray-800 my-6 text-color">
        Hi {userName}, complete your Profile today!
      </Heading>

      <Text className="text-base text-gray-700 mb-6 ">
        We just noticed that have not completed your Profile yet. Please
        complete it at the earliest so you don't miss out on the{" "}
        <strong>premium AI features</strong> that help you get hired in minutes
        and your <strong>Weekly Job Digest</strong> consisting of the best jobs
        out of a pool of <strong>3200+</strong> jobs.
      </Text>

      {/* CTA Button */}
      <Section className="text-start my-16">
        <Button
          href="https://gethired.devhub.co.in/get-started"
          className="bg-black text-white link-color py-3 px-6 rounded-md text-lg font-bold no-underline"
        >
          Complete Profile
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
export default OnboardingReminderEmail;
