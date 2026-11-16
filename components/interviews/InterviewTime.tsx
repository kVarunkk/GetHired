"use client";

import { useEffect, useState } from "react";

/** "Tue, 1 Dec, 10:00 – 10:45" in `zone` (the viewer's when omitted). */
export function formatInterviewTime(startsAt: string, endsAt: string | null, zone?: string): string {
  const start = new Date(startsAt);
  const day = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: zone,
  }).format(start);
  const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: zone });
  const range = endsAt ? `${time.format(start)} – ${time.format(new Date(endsAt))}` : time.format(start);
  return `${day}, ${range}`;
}

/**
 * An interview's time in the viewer's zone. The server renders it in UTC (it
 * doesn't know the zone), then the browser swaps in local time.
 */
export default function InterviewTime({ startsAt, endsAt }: { startsAt: string | null; endsAt?: string | null }) {
  const [text, setText] = useState(() => (startsAt ? `${formatInterviewTime(startsAt, endsAt ?? null, "UTC")} UTC` : ""));
  useEffect(() => {
    if (startsAt) setText(formatInterviewTime(startsAt, endsAt ?? null));
  }, [startsAt, endsAt]);
  if (!startsAt) return <span className="text-muted-foreground">Not booked yet</span>;
  return <time dateTime={startsAt}>{text}</time>;
}
