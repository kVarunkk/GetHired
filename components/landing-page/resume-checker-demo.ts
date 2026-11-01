import type { TResumeReviewServer } from "@/utils/types/review.types";

// Sample data for ResumeCheckerHeroDemo: a parsed resume in the shape the
// resume parser stores (`resumes.content`), and the review the analysis
// writes (`resume_reviews.ai_response`). The bullet ids tie each suggestion to
// the resume line it rewrites, as in the real review.

export const DEMO_RESUME_NAME = "Resume 2026.pdf";

export const DEMO_RESUME_CONTENT = {
  sections: [
    {
      type: "Experience",
      items: [
        {
          heading: "Frontend Engineer, Fieldnote",
          subheading: "2022 – Present · Bengaluru",
          bullets: [
            { id: "demo-b1", text: "Worked on the company's React component library." },
            { id: "demo-b2", text: "Helped improve page load times for the dashboard." },
            { id: "demo-b3", text: "Reviewed pull requests and mentored two junior developers." },
          ],
        },
        {
          heading: "Software Engineer, Orbit Health",
          subheading: "2020 – 2022 · Pune",
          bullets: [
            { id: "demo-b4", text: "Built the checkout flow for the patient payments app." },
            { id: "demo-b5", text: "Wrote unit tests with Jest." },
          ],
        },
      ],
    },
    {
      type: "Projects",
      items: [
        {
          heading: "Open-source date picker",
          bullets: [{ id: "demo-b6", text: "Made an accessible date picker in TypeScript." }],
        },
      ],
    },
    {
      type: "Skills",
      items: [
        {
          bullets: [
            { id: "demo-b7", text: "React, TypeScript, Next.js, Node.js, Jest, Figma" },
          ],
        },
      ],
    },
  ],
};

export const DEMO_JOB_DESCRIPTION = `Senior Frontend Engineer, Lumen Labs (Remote)

We're looking for an engineer to own our design system and the performance of our web app.

You will:
- Lead the React and TypeScript component library used by every product team
- Set and hit Core Web Vitals budgets
- Mentor engineers and raise the bar on code review

You have 5+ years of frontend experience and have shipped payments or checkout flows.`;

export const DEMO_AI_RESPONSE: NonNullable<TResumeReviewServer["ai_response"]> = {
  score: "82",
  overall_feedback:
    "You're a strong fit: design-system work, checkout experience and mentoring all match this role. Your bullets describe tasks rather than results, though. Lead with ownership and numbers, and name the performance metrics the posting asks about.",
  bullet_points: [
    {
      bullet_id: "demo-b1",
      section: "Experience",
      original: "Worked on the company's React component library.",
      suggested:
        "Led the React and TypeScript component library used by 6 product teams, cutting new-screen build time by 40%.",
      reason: "The role's core is owning a design system. Show ownership and reach.",
      priority: "high",
    },
    {
      bullet_id: "demo-b2",
      section: "Experience",
      original: "Helped improve page load times for the dashboard.",
      suggested:
        "Cut the dashboard's Largest Contentful Paint from 4.1s to 1.8s by splitting bundles and streaming data.",
      reason: "The posting asks for Core Web Vitals budgets. Name the metric and the result.",
      priority: "high",
    },
    {
      bullet_id: "demo-b4",
      section: "Experience",
      original: "Built the checkout flow for the patient payments app.",
      suggested:
        "Built the patient payments checkout end to end, processing ₹2Cr a month with a 99.9% success rate.",
      reason: "Checkout experience is a stated requirement. Quantify the scale.",
      priority: "medium",
    },
    {
      bullet_id: "demo-b6",
      section: "Projects",
      original: "Made an accessible date picker in TypeScript.",
      suggested:
        "Published an accessible (WCAG 2.1 AA) TypeScript date picker with 1.2k weekly npm downloads.",
      reason: "Shows component-library craft outside work, which design-system teams value.",
      priority: "low",
    },
  ],
};

/** The review row as the page reads it, with only what the panes use. */
export function demoReview(analysed: boolean): TResumeReviewServer {
  return {
    id: "demo-review",
    name: "Senior Frontend Engineer, Lumen Labs",
    resume_id: "demo-resume",
    status: analysed ? "completed" : "processing",
    score: analysed ? DEMO_AI_RESPONSE.score : null,
    ai_response: analysed ? DEMO_AI_RESPONSE : null,
    analysis_failed: false,
    resumes: {
      id: "demo-resume",
      name: DEMO_RESUME_NAME,
      content: DEMO_RESUME_CONTENT,
      resume_path: "",
      parsing_failed: false,
    },
  } as unknown as TResumeReviewServer;
}
