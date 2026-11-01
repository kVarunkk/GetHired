"use client";

import { usePathname } from "next/navigation";
import {
  ArrowRight,
  Bot,
  FileSearch,
  Layers,
  ListChecks,
  Mic,
  Sparkles,
  Upload,
  Wand2,
  type LucideIcon,
} from "lucide-react";

interface Row {
  icon: LucideIcon;
  before: string;
  after: string;
  detail: string;
}

function applicantRows(jobCount: number): Row[] {
  const jobs = jobCount.toLocaleString("en-US");
  return [
    {
      icon: Layers,
      before: "Checking a dozen job boards every morning",
      after: `One search across ${jobs}+ open roles`,
      detail:
        "Roles from the job boards and startup platforms you already use, in one place and refreshed daily.",
    },
    {
      icon: Sparkles,
      before: "Keyword filters that miss half the good roles",
      after: "Matches ranked against your resume",
      detail:
        "We compare what you've actually done with what each role asks for, so the best fits come first.",
    },
    {
      icon: Wand2,
      before: "Retyping the same answers on every form",
      after: "An agent and extension that fill them in",
      detail:
        "Ask the agent to apply, or let the browser extension draft answers from your profile. You approve before anything is sent.",
    },
    {
      icon: Mic,
      before: "Walking into interviews unprepared",
      after: "Resume reviews and mock interviews first",
      detail:
        "Get specific feedback on your resume, then practise out loud with an AI interviewer.",
    },
  ];
}

const HIRE_ROWS: Row[] = [
  {
    icon: ListChecks,
    before: "Reading every resume to find the few that fit",
    after: "Applicants ranked by fit to the role",
    detail:
      "Each application is scored against the job, so your team starts with the strongest candidates.",
  },
  {
    icon: Mic,
    before: "Booking first-round calls one by one",
    after: "AI screening interviews with written reports",
    detail:
      "Candidates above your threshold are invited automatically. You read the transcript-backed report, not a calendar.",
  },
  {
    icon: Upload,
    before: "Candidates scattered across inboxes and spreadsheets",
    after: "One pipeline for every candidate",
    detail:
      "Import resumes or a spreadsheet, and match your existing candidates to new roles as you open them.",
  },
  {
    icon: Bot,
    before: "Writing posts, emails and summaries by hand",
    after: "A recruiting agent that drafts them for you",
    detail:
      "Ask it to draft a job post, message a shortlist or summarise your funnel. It asks before anything goes out.",
  },
];

export default function TheGetHiredAdvantageSection({
  jobCount,
}: {
  jobCount: number;
}) {
  const isHirePage = !!usePathname()?.startsWith("/hire");
  const rows = isHirePage ? HIRE_ROWS : applicantRows(jobCount);

  return (
    <section className="px-4 lg:px-20 xl:px-40 2xl:px-80">
      <div className="mx-auto max-w-6xl">
        <div className="mb-10 max-w-2xl">
          <p className="mb-3 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <FileSearch className="h-3.5 w-3.5" />
            Why GetHired
          </p>
          <h2 className="text-3xl md:text-4xl font-semibold tracking-tight mb-4">
            {isHirePage
              ? "Less sorting, more hiring"
              : "Less busywork, more interviews"}
          </h2>
          <p className="text-muted-foreground">
            {isHirePage
              ? "The slow parts of hiring, handled. Your team keeps the decisions."
              : "The repetitive parts of a job search, handled. You keep the decisions."}
          </p>
        </div>

        <div className="overflow-hidden rounded-xl border border-border">
          <div className="hidden grid-cols-[minmax(0,2fr)_auto_minmax(0,3fr)] gap-6 border-b border-border bg-muted/40 px-6 py-3 text-xs font-medium text-muted-foreground md:grid">
            <span>The usual way</span>
            <span className="w-4" aria-hidden />
            <span>With GetHired</span>
          </div>
          <ul className="divide-y divide-border">
            {rows.map((row) => (
              <li
                key={row.after}
                className="grid gap-3 px-6 py-6 transition-colors hover:bg-muted/40 md:grid-cols-[minmax(0,2fr)_auto_minmax(0,3fr)] md:items-start md:gap-6"
              >
                <p className="text-sm text-muted-foreground line-through decoration-muted-foreground/40 md:pt-0.5">
                  {row.before}
                </p>
                <ArrowRight
                  className="hidden h-4 w-4 text-muted-foreground md:mt-1 md:block"
                  aria-hidden
                />
                <div className="flex gap-3">
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border bg-background">
                    <row.icon className="h-4 w-4" aria-hidden />
                  </span>
                  <div>
                    <p className="font-medium">{row.after}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {row.detail}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
