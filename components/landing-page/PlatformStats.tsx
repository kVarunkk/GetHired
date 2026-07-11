"use client";

import { NumberTicker } from "../ui/number-ticker";

export default function PlatformStats({
  applicationCount,
  resumeCount,
  userCount,
}: {
  applicationCount: number;
  resumeCount: number;
  userCount: number;
}) {
  return (
    <section className="relative px-4 py-16 lg:px-20 xl:px-40 2xl:px-80 ">
      <div className="text-center mb-16">
        <h2 className="text-3xl md:text-4xl font-bold mb-4">
          The Numbers Behind
        </h2>
        <p className="text-muted-foreground max-w-2xl mx-auto">
          Real-time telemetry from an active network built for speed. No black
          holes, no keyword hacks—just precise, AI-native developer connections.
        </p>
      </div>
      <div className="flex flex-col items-center justify-between flex-wrap sm:flex-row">
        <Card stat={userCount} title="Job seekers" />
        <Card stat={applicationCount} title="Applications submitted" />
        <Card stat={resumeCount} title="Resumes indexed" />
      </div>
    </section>
  );
}

function Card({ stat, title }: { stat: number; title: string }) {
  return (
    <div className="p-4 flex flex-col items-center gap-3 ">
      <NumberTicker className="font-extrabold text-7xl" value={stat} />
      <p className="text-muted-foreground font-medium">{title}</p>
    </div>
  );
}
