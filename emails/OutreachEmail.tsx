import * as React from "react";
import { Button, Img, Link, Section, Text } from "react-email";
import { linkify, paragraphs } from "@/helpers/outreach/linkify";
import { BaseEmailLayout } from "./BaseEmailLayout";

interface OutreachEmailProps {
  companyName: string;
  logoUrl: string | null;
  jobTitle: string | null;
  subject: string;
  /** The company's message, as plain text (OR-SEC-002). */
  message: string;
  /** `/opportunities/<id>` (login required). */
  respondUrl: string;
  settingsUrl: string;
}

/**
 * A company's outreach to a candidate (OR-REQ-002). The message is plain text
 * under "Message from <company>"; only `https://` URLs become links. There are
 * no response buttons, only "View and respond", because mail scanners open
 * links (ALT-003).
 */
export default function OutreachEmail({
  companyName,
  logoUrl,
  jobTitle,
  subject,
  message,
  respondUrl,
  settingsUrl,
}: OutreachEmailProps) {
  return (
    <BaseEmailLayout previewText={`${companyName}: ${subject}`}>
      <Section className="mb-4">
        {logoUrl && <Img src={logoUrl} width="40" height="40" alt="" className="mb-2 rounded-md" />}
        <Text className="m-0 text-xl font-semibold">{subject}</Text>
        {jobTitle && <Text className="m-0 text-sm text-gray-500">{`About: ${jobTitle}`}</Text>}
      </Section>

      <Section className="rounded-md border border-solid border-gray-200 px-4">
        <Text className="mb-0 text-xs font-semibold uppercase text-gray-500">{`Message from ${companyName}`}</Text>
        {paragraphs(message).map((lines, i) => (
          <Text key={i} className="text-sm leading-6">
            {lines.map((line, j) => (
              <React.Fragment key={j}>
                {j > 0 && <br />}
                {linkify(line).map((seg, k) =>
                  seg.type === "link" ? (
                    <Link key={k} href={seg.value} className="text-indigo-600 underline">
                      {seg.value}
                    </Link>
                  ) : (
                    <React.Fragment key={k}>{seg.value}</React.Fragment>
                  ),
                )}
              </React.Fragment>
            ))}
          </Text>
        ))}
      </Section>

      <Section className="my-8 text-center">
        <Button href={respondUrl} className="rounded-md bg-indigo-600 px-5 py-3 text-sm font-semibold text-white">
          View and respond
        </Button>
      </Section>

      <Text className="text-xs text-gray-500">
        {`${companyName} found your public GetHired profile. Your contact details stay hidden until you answer Interested or apply. `}
        <Link href={settingsUrl} className="text-gray-500 underline">
          Stop receiving outreach
        </Link>
      </Text>
    </BaseEmailLayout>
  );
}
