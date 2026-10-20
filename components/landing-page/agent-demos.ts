import type { UIMessage } from "ai";
import { AGENT_PATH, COMPANY_AGENT_PATH } from "@/helpers/agent/prompt-draft";

// Canned conversations for AgentHeroDemo: one per agent role. The tool parts
// use the real tool names and output shapes, so MessageParts renders them the
// way the live chat does.

export type AgentDemo = {
  /** Accessible name of the demo. */
  label: string;
  /** Chat title in the header. */
  title: string;
  /** Where sending, suggestions and the header link go. */
  agentPath: string;
  placeholder: string;
  messages: UIMessage[];
  suggestions: string[];
};

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS).toISOString();

const SAMPLE_JOBS = [
  {
    id: "sample-1",
    title: "Senior Frontend Engineer",
    company: "Lumen Labs",
    locations: ["Remote", "Bengaluru"],
    salary: "₹38L – ₹52L",
    postedAt: daysAgo(1),
    url: "/jobs",
  },
  {
    id: "sample-2",
    title: "Frontend Engineer, Payments",
    company: "Northwind Pay",
    locations: ["Remote"],
    salary: "₹32L – ₹45L",
    postedAt: daysAgo(2),
    url: "/jobs",
  },
  {
    id: "sample-3",
    title: "React Developer",
    company: "Fieldnote",
    locations: ["Remote", "Pune"],
    salary: "₹30L – ₹40L",
    postedAt: daysAgo(4),
    url: "/jobs",
  },
  {
    id: "sample-4",
    title: "Full Stack Engineer (React, Node)",
    company: "Orbit Health",
    locations: ["Remote"],
    salary: "₹34L – ₹48L",
    postedAt: daysAgo(6),
    url: "/jobs",
  },
];

const APPLICANT_REPLY = `I found **4 remote React roles** that fit your resume and your ₹30L minimum. Two stand out:

- **Senior Frontend Engineer at Lumen Labs** wants React, TypeScript and design-system work, which lines up with the component library on your resume.
- **Frontend Engineer, Payments at Northwind Pay** is looking for someone who has shipped checkout flows, like your last role.

Want me to review your resume against one of them before you apply?`;

export const APPLICANT_DEMO: AgentDemo = {
  label: "Example conversation with the GetHired agent",
  title: "Remote React roles",
  agentPath: AGENT_PATH,
  placeholder: "Ask about jobs, your resume or applications…",
  messages: [
    {
      id: "demo-user",
      role: "user",
      parts: [
        {
          type: "text",
          text: "Find remote React jobs that fit my resume. I want at least ₹30L.",
        },
      ],
    },
    {
      id: "demo-reply",
      role: "assistant",
      parts: [
        {
          type: "tool-getMyProfile",
          toolCallId: "demo-profile",
          state: "output-available",
          input: {},
          output: {},
        },
        {
          type: "tool-findRelevantJobs",
          toolCallId: "demo-jobs",
          state: "output-available",
          input: {},
          output: { jobs: SAMPLE_JOBS, totalCount: 4 },
        },
        { type: "text", text: APPLICANT_REPLY },
      ],
    },
  ],
  suggestions: ["Review my resume", "Save the top two", "Only show jobs posted this week"],
};

// Candidate rows link to the talent pool: the sample profiles don't exist.
const SAMPLE_CANDIDATES = [
  {
    id: "sample-c1",
    name: "Priya S",
    roles: ["Frontend Engineer", "React Developer"],
    experienceYears: 6,
    locations: ["Bengaluru"],
    salary: "₹42L",
    matchScore: 91,
    url: "/company/profiles",
  },
  {
    id: "sample-c2",
    name: "Daniel K",
    roles: ["Full Stack Engineer"],
    experienceYears: 5,
    locations: ["Remote"],
    salary: "₹38L",
    matchScore: 86,
    url: "/company/profiles",
  },
  {
    id: "sample-c3",
    name: "Maria L",
    roles: ["Senior Frontend Engineer"],
    experienceYears: 7,
    locations: ["Pune"],
    salary: "₹48L",
    matchScore: 82,
    url: "/company/profiles",
  },
  {
    id: "sample-c4",
    name: "Arjun M",
    roles: ["React Developer"],
    experienceYears: 5,
    locations: ["Hyderabad", "Remote"],
    salary: "₹36L",
    matchScore: 78,
    url: "/company/profiles",
  },
];

const RECRUITER_REPLY = `I found **4 strong matches** for your Senior Frontend Engineer post, all with 5+ years of React. Two stand out:

- **Priya S** has led a design-system rebuild in React and TypeScript, which is the core of this role.
- **Maria L** has 7 years on large frontend codebases and has mentored a team of four.

Want me to invite them to the AI screening interview, or send them a message first?`;

export const RECRUITER_DEMO: AgentDemo = {
  label: "Example conversation with the GetHired recruiting agent",
  title: "Senior Frontend Engineer shortlist",
  agentPath: COMPANY_AGENT_PATH,
  placeholder: "Ask about candidates, job posts or your pipeline…",
  messages: [
    {
      id: "demo-user",
      role: "user",
      parts: [
        {
          type: "text",
          text: "Find candidates for my Senior Frontend Engineer post. They need 5+ years of React.",
        },
      ],
    },
    {
      id: "demo-reply",
      role: "assistant",
      parts: [
        {
          type: "tool-getJobPost",
          toolCallId: "demo-job",
          state: "output-available",
          input: {},
          output: {},
        },
        {
          type: "tool-findMatchesForJob",
          toolCallId: "demo-matches",
          state: "output-available",
          input: {},
          output: { candidates: SAMPLE_CANDIDATES },
        },
        { type: "text", text: RECRUITER_REPLY },
      ],
    },
  ],
  suggestions: ["Invite the top two to interview", "Compare Priya and Maria", "Draft a job post"],
};
