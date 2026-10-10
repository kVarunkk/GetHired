import Link from "next/link";
import { ArrowRight, FileCheck2, Mic } from "lucide-react";
import { Button } from "./ui/button";
import { platforms } from "@/utils/utils";

const tools = [
  {
    href: "/ai-resume-checker",
    label: "Check your resume for ATS issues",
    icon: FileCheck2,
  },
  {
    href: "/ai-interview",
    label: "Practice with an AI interviewer",
    icon: Mic,
  },
];

export default function BlogSidebarCTA() {
  return (
    <div className="rounded-xl border bg-card p-5 shadow-sm">
      <h2 className="text-xl font-bold leading-snug">
        Find your next role faster
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Browse jobs from {platforms.length} ATS platforms like Greenhouse,
        Workday and Ashby, matched to your resume with AI.
      </p>
      <Button asChild className="mt-4 w-full">
        <Link href="/jobs">
          Browse jobs
          <ArrowRight className="ms-2 h-4 w-4" />
        </Link>
      </Button>

      <ul className="mt-5 space-y-1 border-t pt-4">
        {tools.map(({ href, label, icon: Icon }) => (
          <li key={href}>
            <Link
              href={href}
              className="flex items-center gap-3 rounded-md px-2 py-2 text-sm underline underline-offset-4 transition-colors hover:bg-muted"
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
