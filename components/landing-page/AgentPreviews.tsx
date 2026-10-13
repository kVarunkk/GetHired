import { Badge } from "../ui/badge";
import { cn } from "@/utils/utils";
import { Bot, Mic, Sparkles } from "lucide-react";

// Small, static previews of the /agent chat for the landing-page cards. They copy
// the agent's look (user bubble, reply text, bordered result list) and are
// decorative: the card text next to them says what each one shows.

export function PreviewFrame({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      aria-hidden
      className={cn(
        // Fixed height so the card's text always has room; the bottom fades out.
        "pointer-events-none h-48 select-none overflow-hidden p-4 pb-0 [mask-image:linear-gradient(to_bottom,#000_70%,transparent)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

function UserBubble({ children }: { children: React.ReactNode }) {
  return (
    <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-secondary px-3 py-2 text-sm text-secondary-foreground">
      {children}
    </p>
  );
}

function AgentLine({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2 text-sm text-muted-foreground">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border bg-background">
        <Bot className="h-3 w-3" />
      </span>
      {children}
    </p>
  );
}

const MATCHES = [
  {
    title: "Senior Frontend Engineer",
    company: "Northwind",
    meta: "Remote · $140k",
  },
  { title: "React Developer", company: "Lumen Labs", meta: "Remote · $125k" },
  {
    title: "Full Stack Engineer",
    company: "Acme Cloud",
    meta: "Remote · $130k",
  },
];

/** "Find me remote React roles" → a short ranked list, like the agent's job results. */
export function AgentJobSearchPreview() {
  return (
    <PreviewFrame className="flex flex-col gap-3">
      <UserBubble>Remote React roles over $120k that sponsor visas</UserBubble>
      <AgentLine>I found 3 strong matches for your resume:</AgentLine>
      <ul className="divide-y rounded-xl border bg-background">
        {MATCHES.map((job) => (
          <li
            key={job.title}
            className="flex items-center justify-between gap-3 px-3 py-2"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{job.title}</p>
              <p className="truncate text-xs text-muted-foreground">
                {job.company} · {job.meta}
              </p>
            </div>
            <Badge variant="success" className="shrink-0">
              Match
            </Badge>
          </li>
        ))}
      </ul>
    </PreviewFrame>
  );
}

const APPLICATIONS = [
  {
    company: "Northwind",
    role: "Frontend Engineer",
    status: "Reviewed",
    variant: "warning",
  },
  {
    company: "Lumen Labs",
    role: "React Developer",
    status: "Selected",
    variant: "success",
  },
  {
    company: "Acme Cloud",
    role: "Full Stack Engineer",
    status: "Submitted",
    variant: "secondary",
  },
] as const;

/** "What's still pending?" → the user's applications with their statuses. */
export function AgentApplicationsPreview() {
  return (
    <PreviewFrame className="flex flex-col gap-3">
      <UserBubble>Where are my applications at?</UserBubble>
      <AgentLine>Here&apos;s where each one stands:</AgentLine>
      <ul className="divide-y rounded-xl border bg-background">
        {APPLICATIONS.map((app) => (
          <li
            key={app.company}
            className="flex items-center justify-between gap-3 px-3 py-2"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{app.company}</p>
              <p className="truncate text-xs text-muted-foreground">
                {app.role}
              </p>
            </div>
            <Badge variant={app.variant} className="shrink-0">
              {app.status}
            </Badge>
          </li>
        ))}
      </ul>
    </PreviewFrame>
  );
}

/** A resume review next to mock-interview feedback, both things the agent sets up. */
export function AgentPrepPreview() {
  return (
    <PreviewFrame className="grid gap-3 sm:grid-cols-2">
      <div className="rounded-xl border bg-background p-3">
        <div className="flex items-center justify-between">
          <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5" />
            Resume review
          </p>
          <p className="text-lg font-semibold tracking-tight text-success">
            82
          </p>
        </div>
        <div className="mt-2 space-y-1.5 rounded-lg border border-brand/30 bg-brandSoft p-2.5">
          <p className="text-xs text-muted-foreground line-through">
            Worked on the checkout page
          </p>
          <p className="text-sm font-medium">
            Rebuilt checkout in React, cutting drop-off by 18%
          </p>
        </div>
      </div>
      <div className="rounded-xl border bg-background p-3">
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Mic className="h-3.5 w-3.5" />
          Mock interview feedback
        </p>
        <dl className="mt-2 divide-y text-sm">
          <div className="flex items-center justify-between py-1.5">
            <dt className="text-muted-foreground">Communication</dt>
            <dd className="font-semibold text-success">4/5</dd>
          </div>
          <div className="flex items-center justify-between py-1.5">
            <dt className="text-muted-foreground">Role fit</dt>
            <dd className="font-semibold text-warning">3/5</dd>
          </div>
          <div className="py-1.5 text-xs text-muted-foreground">
            Try this: lead with the result, then how you got there.
          </div>
        </dl>
      </div>
    </PreviewFrame>
  );
}
