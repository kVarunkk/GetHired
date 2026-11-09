import * as React from "react";
import { BaseEmailLayout } from "@/emails/BaseEmailLayout";
import { Heading, Text, Section, Button, Link } from "react-email";
import { deploymentUrl } from "@/utils/formatters";

/**
 * RE-REQ-098: a user whose resume file couldn't be re-parsed is asked to upload
 * it again. The file is deleted 30 days after this email (RE-DEC-009).
 */
export const ResumeReuploadEmail = ({ resumeName }: { resumeName: string }) => {
  const link = `${deploymentUrl()}/resume`;

  return (
    <BaseEmailLayout previewText={`Please upload ${resumeName} again`}>
      <Heading className="text-2xl font-bold text-gray-800 my-6">
        Please upload {resumeName} again
      </Heading>

      <Text className="text-base text-gray-700 mb-6">
        We couldn&apos;t read <strong>{resumeName}</strong> when we updated our resumes, so it&apos;s
        missing its details in your account. Uploading it again only takes a moment, and your
        reviews and applications stay where they are.
      </Text>

      <Text className="text-base text-gray-700 mb-6">
        We&apos;ll keep the old file for 30 days in case you need it, then delete it.
      </Text>

      <Section className="text-center my-8">
        <Button
          href={link}
          className="bg-black text-white py-3 px-6 rounded-md text-lg font-bold no-underline"
          style={{ backgroundColor: "#000000", color: "#FFFFFF" }}
        >
          Upload it again
        </Button>
      </Section>

      <Text className="text-sm text-gray-500 mt-6">
        If the button doesn&apos;t work, copy and paste this link into your browser:
        <br />
        <Link href={link} className="text-blue-600 underline break-all">
          {link}
        </Link>
      </Text>
    </BaseEmailLayout>
  );
};

export default ResumeReuploadEmail;
