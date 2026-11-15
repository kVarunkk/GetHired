import * as React from "react";
import { Button, Section, Text } from "react-email";
import { BaseEmailLayout } from "./BaseEmailLayout";

interface CalendarReconnectEmailProps {
  /** Settings → My calendar, absolute. */
  url: string;
}

/** §4 Failures: Google stopped accepting GetHired's access to the member's calendar. */
export default function CalendarReconnectEmail({ url }: CalendarReconnectEmailProps) {
  return (
    <BaseEmailLayout previewText="Reconnect your Google Calendar to keep scheduling interviews.">
      <Text className="text-xl font-semibold">Reconnect your Google Calendar</Text>
      <Text className="text-sm">
        GetHired can no longer reach your Google Calendar. This happens when access is removed in your Google
        Account, your password changes, or your organization blocks the app.
      </Text>
      <Text className="text-sm">
        Until you reconnect, teammates see your availability as unknown, and interviews you organize can&apos;t be
        moved or cancelled from GetHired.
      </Text>
      <Section className="my-8 text-center">
        <Button href={url} className="rounded-md bg-indigo-600 px-5 py-3 text-sm font-semibold text-white">
          Reconnect your calendar
        </Button>
      </Section>
    </BaseEmailLayout>
  );
}
