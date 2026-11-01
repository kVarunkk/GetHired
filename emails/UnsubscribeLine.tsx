import * as React from "react";
import { Link, Text } from "react-email";

/** BI-REQ-034: the line every email to a company candidate ends with. */
export function UnsubscribeLine({ companyName, url }: { companyName: string; url: string | null | undefined }) {
  if (!url) return null;
  return (
    <Text className="text-xs text-gray-500">
      {`Don't want emails from ${companyName}? `}
      <Link href={url} className="text-gray-500 underline">
        Unsubscribe
      </Link>
    </Text>
  );
}
