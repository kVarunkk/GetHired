import * as React from "react";
import { Button, Section, Text } from "react-email";
import { BaseEmailLayout } from "./BaseEmailLayout";

type InterviewAccommodationRequestEmailProps =
  | {
      kind: "accommodation";
      candidateName: string;
      jobTitle: string;
      /** The candidate's own words, ≤ 500 characters. */
      message: string;
      applicantUrl: string;
    }
  | { kind: "declined"; candidateName: string; jobTitle: string; applicantUrl: string };

/** SI-REQ-016/026: the candidate asked for another format, or declined. */
export default function InterviewAccommodationRequestEmail(props: InterviewAccommodationRequestEmailProps) {
  const { candidateName, jobTitle, applicantUrl } = props;
  const accommodation = props.kind === "accommodation";

  return (
    <BaseEmailLayout previewText="">
      <Text className="text-xl font-semibold">
        {accommodation ? "An interview accommodation request" : "An AI interview was declined"}
      </Text>
      {accommodation ? (
        <>
          <Text className="text-sm">
            {`${candidateName} asked for an alternative to the AI interview for ${jobTitle}. Their deadline is paused until you respond.`}
          </Text>
          <Text className="border-l-4 border-gray-300 pl-3 text-sm italic">{props.message}</Text>
          <Text className="text-sm">
            From their application you can extend the deadline, waive the interview and move them on, or cancel it.
          </Text>
        </>
      ) : (
        <Text className="text-sm">
          {`${candidateName} declined the AI interview for ${jobTitle}. Their application is still open.`}
        </Text>
      )}

      <Section className="my-8 text-center">
        <Button
          href={applicantUrl}
          className="rounded-md bg-indigo-600 px-5 py-3 text-sm font-semibold text-white"
        >
          Open the application
        </Button>
      </Section>
    </BaseEmailLayout>
  );
}
