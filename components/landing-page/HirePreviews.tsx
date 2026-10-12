import { Badge } from "../ui/badge";
import { Briefcase, Sparkles, Users } from "lucide-react";
import { PreviewFrame } from "./AgentPreviews";

// Static previews of the company dashboard for the /hire landing cards, in the
// same style as the agent previews. Decorative: the card text says what each shows.

function Initials({ name }: { name: string }) {
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border bg-secondary text-xs font-medium">
      {name
        .split(" ")
        .map((part) => part[0])
        .join("")}
    </span>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
      {children}
    </p>
  );
}

const CANDIDATES = [
  { name: "Priya S", detail: "6 yrs · React, TypeScript" },
  { name: "Daniel K", detail: "5 yrs · Next.js, Node.js" },
  { name: "Maria L", detail: "4 yrs · React, GraphQL" },
];

/** Candidates ranked for one job post. */
export function HireCandidatesPreview() {
  return (
    <PreviewFrame className="flex flex-col gap-3">
      <Label>
        <Sparkles className="h-3.5 w-3.5" />
        Best matches for Senior Frontend Engineer
      </Label>
      <ul className="divide-y rounded-xl border bg-background">
        {CANDIDATES.map((c) => (
          <li key={c.name} className="flex items-center gap-3 px-3 py-2">
            <Initials name={c.name} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{c.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {c.detail}
              </p>
            </div>
            <Badge variant="success" className="shrink-0">
              Profile Match
            </Badge>
          </li>
        ))}
      </ul>
    </PreviewFrame>
  );
}

const APPLICANTS = [
  { name: "Priya S", status: "Selected", variant: "success" },
  { name: "Daniel K", status: "Reviewed", variant: "warning" },
  { name: "Maria L", status: "Submitted", variant: "secondary" },
] as const;

/** Applicants for a role, each with its status. */
export function HireApplicantsPreview() {
  return (
    <PreviewFrame className="flex flex-col gap-3">
      <Label>
        <Users className="h-3.5 w-3.5" />
        Applicants · Frontend Engineer
      </Label>
      <ul className="divide-y rounded-xl border bg-background">
        {APPLICANTS.map((a) => (
          <li key={a.name} className="flex items-center gap-3 px-3 py-2">
            <Initials name={a.name} />
            <p className="min-w-0 flex-1 truncate text-sm font-medium">
              {a.name}
            </p>
            <Badge variant={a.variant} className="shrink-0">
              {a.status}
            </Badge>
          </li>
        ))}
      </ul>
    </PreviewFrame>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

function FakeInput({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-background px-3 py-1.5 text-sm">
      {children}
    </div>
  );
}

/** The job post form, with the fields the template requires. Tall card on desktop. */
export function HireComposerPreview() {
  return (
    <PreviewFrame className="lg:h-[26rem]">
      <div className="space-y-3 rounded-xl border bg-background p-3">
        <Label>
          <Briefcase className="h-3.5 w-3.5" />
          New job post
        </Label>
        <Field label="Job title">
          <FakeInput>Senior Frontend Engineer</FakeInput>
        </Field>
        <Field label="Locations">
          <div className="flex flex-wrap gap-1.5">
            {["Remote", "Bengaluru", "London"].map((loc) => (
              <span
                key={loc}
                className="rounded-full border px-2.5 py-0.5 text-sm"
              >
                {loc}
              </span>
            ))}
          </div>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Salary">
            <FakeInput>$120k – $150k</FakeInput>
          </Field>
          <Field label="Experience">
            <FakeInput>4–6 years</FakeInput>
          </Field>
        </div>
        <Field label="Screening questions">
          <div className="space-y-1.5">
            <FakeInput>Tell us about a UI you&apos;re proud of.</FakeInput>
            <FakeInput>Why this role?</FakeInput>
          </div>
        </Field>
        <div className="flex justify-end">
          <span className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-brand-foreground">
            Post Job
          </span>
        </div>
      </div>
    </PreviewFrame>
  );
}

const ROLES = [
  { title: "Senior Frontend Engineer", applicants: 12 },
  { title: "Backend Engineer", applicants: 8 },
];

/** Open roles next to a pre-screened candidate, the company dashboard in brief. */
export function HirePipelinePreview() {
  return (
    <PreviewFrame className="grid gap-3 sm:grid-cols-2">
      <div className="rounded-xl border bg-background p-3">
        <Label>
          <Briefcase className="h-3.5 w-3.5" />
          Open roles
        </Label>
        <ul className="mt-2 divide-y">
          {ROLES.map((role) => (
            <li
              key={role.title}
              className="flex items-center justify-between gap-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{role.title}</p>
                <p className="text-xs text-muted-foreground">
                  {role.applicants} applicants
                </p>
              </div>
              <Badge variant="success" className="shrink-0">
                Active
              </Badge>
            </li>
          ))}
        </ul>
      </div>
      <div className="rounded-xl border bg-background p-3">
        <Label>
          <Sparkles className="h-3.5 w-3.5" />
          Pre-screened for you
        </Label>
        <div className="mt-2 flex items-center gap-3 rounded-lg border border-brand/30 bg-brandSoft p-2.5">
          <Initials name="Priya S" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">Priya S</p>
            <p className="truncate text-xs text-muted-foreground">
              Senior Frontend Engineer · 6 yrs
            </p>
          </div>
          <Badge variant="success" className="shrink-0">
            Profile Match
          </Badge>
        </div>
      </div>
    </PreviewFrame>
  );
}
