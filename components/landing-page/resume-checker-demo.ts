import type { UIMessage } from "ai";
import { AGENT_PATH } from "@/helpers/agent/prompt-draft";
import type { ApplySuggestionsInput, ApplySuggestionsResult } from "@/helpers/resume-review/apply-suggestions";
import type { ReviewChange } from "@/helpers/resume-review/changes";
import type { ChangesTarget, ResumeChangesView } from "@/helpers/resume-review/load-changes";
import type { AgentDemo } from "./agent-demos";

// Sample data for ResumeCheckerHeroDemo: the agent tailoring a resume to a job.
// The resume is in the shape the editor stores, and the review is the
// `ResumeChangesView` that `loadResumeChangesAction` returns, so the agent's
// own changes card renders it: rewrites, a new bullet with values to fill in,
// a removal, a move, the live diff and the questions about gaps.

export const DEMO_RESUME_NAME = "Resume 2026";

const CONTENT: ChangesTarget["content"] = {
  version: 2,
  sections: [
    {
      id: "demo-s-summary",
      type: "summary",
      items: [
        {
          id: "demo-i-summary",
          bullets: [{ id: "demo-b0", text: "Frontend engineer with 5 years of experience building web apps." }],
        },
      ],
    },
    {
      id: "demo-s-experience",
      type: "experience",
      items: [
        {
          id: "demo-i-fieldnote",
          heading: "Frontend Engineer",
          subheading: "Fieldnote",
          location: "Bengaluru",
          startDate: "2022",
          endDate: "Present",
          bullets: [
            { id: "demo-b1", text: "Worked on the company's React component library." },
            { id: "demo-b2", text: "Helped improve page load times for the dashboard." },
            { id: "demo-b3", text: "Reviewed pull requests and mentored two junior developers." },
            { id: "demo-b4", text: "Attended weekly team meetings and sprint planning." },
          ],
        },
        {
          id: "demo-i-orbit",
          heading: "Software Engineer",
          subheading: "Orbit Health",
          location: "Pune",
          startDate: "2020",
          endDate: "2022",
          bullets: [
            { id: "demo-b5", text: "Built the checkout flow for the patient payments app." },
            { id: "demo-b6", text: "Wrote unit tests with Jest." },
          ],
        },
      ],
    },
    {
      id: "demo-s-projects",
      type: "projects",
      items: [
        {
          id: "demo-i-datepicker",
          heading: "Open-source date picker",
          bullets: [{ id: "demo-b7", text: "Made an accessible date picker in TypeScript." }],
        },
      ],
    },
    {
      id: "demo-s-skills",
      type: "skills",
      items: [
        {
          id: "demo-i-skills",
          bullets: [{ id: "demo-b8", text: "React, TypeScript, Next.js, Node.js, Jest, Figma" }],
        },
      ],
    },
    {
      id: "demo-s-education",
      type: "education",
      items: [
        {
          id: "demo-i-education",
          heading: "B.Tech, Computer Science",
          subheading: "VIT Vellore",
          startDate: "2016",
          endDate: "2020",
          bullets: [],
        },
      ],
    },
  ],
};

const reason = (text: string, priority: "high" | "medium" | "low") => ({ reason: text, priority });

export const DEMO_CHANGES: ReviewChange[] = [
  {
    kind: "rewrite",
    id: "demo-b1",
    bullet_id: "demo-b1",
    original: "Worked on the company's React component library.",
    suggested:
      "Led the React and TypeScript component library used by 6 product teams, cutting new-screen build time by 40%.",
    ...reason("The role is about owning a design system. Show ownership and reach.", "high"),
  },
  {
    kind: "rewrite",
    id: "demo-b2",
    bullet_id: "demo-b2",
    original: "Helped improve page load times for the dashboard.",
    suggested: "Cut the dashboard's Largest Contentful Paint from 4.1s to 1.8s by splitting bundles and streaming data.",
    ...reason("The posting asks for Core Web Vitals budgets. Name the metric and the result.", "high"),
  },
  {
    kind: "add",
    id: "demo-add-cwv",
    item_id: "demo-i-fieldnote",
    anchors: ["demo-b2", "demo-b1"],
    suggested: "Set Core Web Vitals budgets in CI that kept LCP under [X]s across [N] releases.",
    ...reason("The job asks you to set and hit performance budgets. Fill in your numbers.", "medium"),
  },
  {
    kind: "rewrite",
    id: "demo-b5",
    bullet_id: "demo-b5",
    original: "Built the checkout flow for the patient payments app.",
    suggested: "Built the patient payments checkout end to end, processing ₹2Cr a month with a 99.9% success rate.",
    ...reason("Checkout experience is a stated requirement. Quantify the scale.", "medium"),
  },
  {
    kind: "remove",
    id: "demo-remove-meetings",
    bullet_id: "demo-b4",
    original: "Attended weekly team meetings and sprint planning.",
    ...reason("Every engineer does this. It takes space from your results.", "low"),
  },
  {
    kind: "move",
    id: "demo-move-skills",
    target_id: "demo-s-skills",
    index: 1,
    ...reason("The posting screens for React and TypeScript first, so put your skills near the top.", "low"),
  },
];

const pending = Object.fromEntries(DEMO_CHANGES.map((change) => [change.id, "pending" as const]));

const target = (resumeId: string | null): ChangesTarget => ({
  resumeId,
  template: "classic",
  contact: {
    fullName: "Your Name",
    headline: "Frontend Engineer",
    location: "Bengaluru",
    links: [],
  },
  content: CONTENT,
  states: pending,
  applied: {},
});

export const DEMO_VIEW: ResumeChangesView = {
  reviewId: "demo-review",
  summary:
    "You're a strong fit: design-system work, checkout experience and mentoring all match this role. Your bullets describe tasks rather than results, though, so I've rewritten them around ownership and numbers.",
  resumeName: DEMO_RESUME_NAME,
  target: { job: null, pastedJob: true, focus: "Senior Frontend Engineer" },
  changes: DEMO_CHANGES,
  gaps: [
    {
      requirement: "5+ years of frontend experience",
      question: "Your dates add up to about 4.5 years. Did you do frontend work before 2020, like an internship?",
    },
    {
      requirement: "Design-system ownership",
      question: "Did you set the component library's direction, or mostly contribute to it?",
    },
  ],
  original: target("demo-resume"),
  copy: target(null),
};

/** How long the local Apply spins, so it reads like the real one. */
export const DEMO_APPLY_MS = 700;

/** A local stand-in for `applyReviewSuggestionsAction`: nothing is saved. */
export function demoApply(input: ApplySuggestionsInput) {
  const target = input.target ?? "copy";
  return new Promise<ApplySuggestionsResult>((resolve) =>
    window.setTimeout(
      () =>
        resolve({
          ok: true,
          target,
          targetResumeId: target === "copy" ? "demo-copy" : "demo-resume",
          items: input.items.map((item) => ({ id: item.id, status: "applied" as const })),
        }),
      DEMO_APPLY_MS,
    ),
  );
}

const REPLY = `I compared **${DEMO_RESUME_NAME}** with the Senior Frontend Engineer posting you pasted and found **6 changes**. Tick the ones you want, edit any wording, and check the diff before you apply. Nothing changes until you press Apply.`;

export const RESUME_DEMO: AgentDemo = {
  label: "Example of the GetHired agent tailoring a resume",
  title: "Tailor my resume",
  agentPath: AGENT_PATH,
  placeholder: "Ask the agent to tailor your resume for a job…",
  messages: [
    {
      id: "demo-user",
      role: "user",
      parts: [
        {
          type: "text",
          text: "Tailor my resume for this Senior Frontend Engineer role at Lumen Labs. I've pasted the job description.",
        },
      ],
    },
    {
      id: "demo-reply",
      role: "assistant",
      parts: [
        {
          type: "tool-getResumeContent",
          toolCallId: "demo-read",
          state: "output-available",
          input: {},
          output: {},
        },
        {
          type: "tool-improveResume",
          toolCallId: "demo-improve",
          state: "output-available",
          input: {},
          output: {},
        },
        { type: "text", text: REPLY },
      ],
    } satisfies UIMessage,
  ],
  suggestions: [
    "Tailor my resume for a job I like",
    "Find jobs that fit my resume",
    "Export my resume as a PDF",
  ],
};
