"use client";

import { usePathname } from "next/navigation";
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
  const isHirePage = !!usePathname()?.startsWith("/hire");
  const stats = [
    { value: userCount, label: "Job seekers on GetHired" },
    { value: applicationCount, label: "Applications submitted" },
    { value: resumeCount, label: "Resumes indexed for matching" },
  ];

  return (
    <section className="px-4 lg:px-20 xl:px-40 2xl:px-80">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <h2 className="text-2xl md:text-3xl font-semibold tracking-tight">
            {isHirePage
              ? "A talent pool that is already here"
              : "Used by real job seekers"}
          </h2>
          <p className="text-sm text-muted-foreground">
            Live counts, refreshed daily.
          </p>
        </div>
        <dl className="grid grid-cols-1 divide-y divide-border rounded-xl border border-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          {stats.map((stat) => (
            <div key={stat.label} className="flex flex-col gap-2 p-6 sm:p-8">
              <dt className="order-2 text-sm text-muted-foreground">
                {stat.label}
              </dt>
              <dd className="order-1">
                <NumberTicker
                  className="text-4xl sm:text-5xl font-semibold tracking-tight tabular-nums"
                  value={stat.value}
                />
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
