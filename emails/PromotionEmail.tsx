import * as React from "react";
import { BaseEmailLayout } from "./BaseEmailLayout";
import { Heading, Text, Section, Button, Img } from "react-email";

interface PromotionEmailProps {
  userName: string;
  emailTitle: string;
  mainContent: string;
  ctaLink: string;
  ctaLabel: string;
  gifPreviewImageUrl?: string; // The URL of the GIF file
}

export const PromotionEmail = ({
  userName,
  emailTitle,
  mainContent,
  ctaLink,
  ctaLabel,
  gifPreviewImageUrl,
}: PromotionEmailProps) => {
  const previewText = ``;

  return (
    <BaseEmailLayout previewText={previewText}>
      <Heading className="text-2xl font-bold text-gray-800 my-6 text-color">
        Hi {userName}!
      </Heading>

      <Heading className="text-xl font-semibold text-gray-800 mb-6 text-color">
        {emailTitle}
      </Heading>

      {/* --- GIF/Video Preview Section (The Clickable GIF) --- */}
      {gifPreviewImageUrl && (
        <Section className="my-8 text-center" style={{ lineHeight: 0 }}>
          <Img
            src={gifPreviewImageUrl}
            alt="Animated Preview: Click to Watch Video"
            width="100%"
            style={{
              maxWidth: "600px",
              height: "auto",
              borderRadius: "8px",
              border: "2px solid #ddd",
              display: "block",
            }}
          />
        </Section>
      )}
      {/* --- END GIF/Video Preview --- */}

      {/* Main Content Body */}
      {/* <Text className="text-base text-gray-700 mb-6 text-color">
        {mainContent}
      </Text> */}

      {/* {mainContent} */}

      <div dangerouslySetInnerHTML={{ __html: mainContent }} />

      {/* CTA Button */}
      <Section className="text-center my-8">
        <Button
          href={ctaLink}
          className="bg-black text-white py-3 px-6 rounded-md text-lg font-bold no-underline"
        >
          {ctaLabel}
        </Button>
      </Section>

      <Text className="text-base text-gray-700 text-color mt-10">
        Best regards,
        <br />
        The GetHired Team
      </Text>
    </BaseEmailLayout>
  );
};

export default PromotionEmail;
