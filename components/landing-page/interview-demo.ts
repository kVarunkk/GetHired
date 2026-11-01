import type { TInterviewServer } from "@/utils/types/interview.types";

// Sample data for InterviewHeroDemo: a practice interview with one saved
// session (shown as the historical transcript before the visitor starts), and
// the script the demo plays when they press Start Interview.

export type DemoTurn = { assistant: string; user?: string };

const SAVED_TURNS = [
  {
    turn_id: "1",
    user: "",
    assistant:
      "Hi! I'm your AI interviewer for the Senior Frontend Engineer role at Lumen Labs. To start, tell me about a component library you've worked on.",
  },
  {
    turn_id: "2",
    user: "At Fieldnote I led our React and TypeScript library. Six product teams build on it, and it cut new-screen build time by about forty percent.",
    assistant:
      "Nice. How did you keep six teams from forking components when they needed something slightly different?",
  },
  {
    turn_id: "3",
    user: "We added composition slots and a weekly design review, so teams asked for variants instead of copying code.",
    assistant: "That's a solid answer. Let's talk about performance next.",
  },
];

export const DEMO_SCRIPT: DemoTurn[] = [
  {
    assistant:
      "Welcome back! The posting mentions Core Web Vitals budgets. Walk me through a time you improved page performance.",
    user: "Our dashboard's LCP was over four seconds. I split the bundle by route and streamed the data, which brought it to 1.8 seconds.",
  },
  {
    assistant: "Good, you named the metric. How did you make sure it didn't regress later?",
    user: "We added a Lighthouse check to CI that fails the build if LCP goes over two and a half seconds.",
  },
  {
    assistant:
      "Great. Last one: tell me about mentoring an engineer through a tough code review.",
  },
];

export const DEMO_INTERVIEW_ID = "demo-interview";
const DEMO_SESSION_ID = "demo-session";

export const DEMO_INTERVIEW = {
  id: DEMO_INTERVIEW_ID,
  name: "Lumen Labs frontend practice",
  kind: "practice",
  job_id: null,
  resume_id: null,
  turns: [],
  all_jobs: { job_name: "Senior Frontend Engineer, Lumen Labs" },
  resumes: { name: "Resume 2026" },
  interview_sessions: [{ id: DEMO_SESSION_ID, turns: SAVED_TURNS }],
} as unknown as TInterviewServer;

/** No analysis status, so the page's Analysis link (to a real report) stays hidden. */
export const DEMO_SESSION_HISTORY = [
  {
    id: DEMO_SESSION_ID,
    started_at: "2026-10-28T10:00:00Z",
    status: "completed",
    analysisStatus: null,
  },
];
