// Copy shared by the marketing pages and their markdown versions (`/hire.md`,
// `/index.md`, ...), so the two can't drift. Client-safe: no server imports.

import { agentPromptHref, COMPANY_AGENT_PATH } from "@/helpers/agent/prompt-draft";
import { MCP_PATH } from "@/helpers/mcp/config";

export const SITE_URL = "https://gethired.devhub.co.in";

export const IMPROVE_RESUME_PROMPT = "Improve my resume for a job I like. Ask me which job first.";

export const FAQS = {
  "job-search": [
    {
      question: "What is the GetHired agent?",
      answer:
        "An AI assistant you chat with. It searches jobs, finds roles matched to your resume, tracks your applications, improves your resume and sets up mock interviews. It asks before changing your profile, and AI features use credits as shown in your account.",
    },
    {
      question: "How can I find relevant tech jobs on GetHired?",
      answer:
        "Search current developer and tech openings, then narrow results by job title, location, job type, salary, and experience.",
    },
    {
      question: "How does AI help with my job search?",
      answer:
        "GetHired uses profile and job details to provide personalized job recommendations in addition to standard keyword-based search.",
    },
    {
      question: "Can I apply to jobs from different companies?",
      answer:
        "Yes. GetHired brings together listings from company career sites and hiring platforms. Application steps depend on the individual listing.",
    },
    {
      question: "Is GetHired free for job seekers?",
      answer:
        "GetHired offers free features for job seekers. Some AI features may use credits, as shown in your account.",
    },
  ],
  hiring: [
    {
      question: "How can a company post a job on GetHired?",
      answer:
        "Create a company account, complete company onboarding, and use the company dashboard to create and manage job postings.",
    },
    {
      question: "How does GetHired help employers review applicants?",
      answer:
        "Employers can manage their job postings and applicants from the company dashboard, with AI features available to support candidate review.",
    },
    {
      question: "Can job seekers and employers both use GetHired?",
      answer:
        "Yes. Job seekers can search roles and manage applications, while employers can post openings and review applicants.",
    },
  ],
  "ai-interview": [
    {
      question: "What is GetHired's AI interview practice?",
      answer:
        "It provides AI-powered interview practice sessions to help you prepare for upcoming job interviews.",
    },
    {
      question: "Do I get feedback after an AI interview practice session?",
      answer:
        "GetHired provides personalized feedback so you can identify areas to improve before a real interview.",
    },
    {
      question: "Who can use interview practice?",
      answer:
        "Job seekers preparing for interviews can use GetHired's AI interview feature as part of their job search.",
    },
  ],
  resume: [
    {
      question: "What does the AI resume checker review?",
      answer:
        "GetHired analyzes your resume and provides feedback to help you improve how it presents your experience for a target role.",
    },
    {
      question: "Can I check my resume against a job description?",
      answer:
        "GetHired includes tools to compare a resume with job requirements and identify relevant areas to improve.",
    },
    {
      question: "Does a resume checker guarantee an interview?",
      answer:
        "No. Resume feedback can help you improve your materials, but hiring decisions are made by employers and no interview outcome is guaranteed.",
    },
  ],
  remote: [
    {
      question: "How do I find remote jobs on GetHired?",
      answer:
        "Search the job listings and use the location filter to find remote roles and opportunities in your preferred location.",
    },
    {
      question: "Can I filter jobs by location and job type?",
      answer:
        "Yes. The job search includes filters for location and job type, along with other criteria such as salary and experience.",
    },
    {
      question: "Where do I apply for a remote job?",
      answer:
        "Open a job listing to review its requirements and application instructions. Some employers accept applications on their own career sites.",
    },
  ],
  extension: [
    {
      question: "What does the GetHired Chrome Extension do?",
      answer:
        "It fills in job application forms for you on company career sites and hiring platforms, using the details from your GetHired profile and primary resume.",
    },
    {
      question: "Can it answer open-ended application questions?",
      answer:
        "Yes. For questions like \"Why do you want to work here?\", it writes a plain-text answer in your voice, based on your resume, your profile and the job you're applying to. It only uses facts from your background and won't invent links or details.",
    },
    {
      question: "Do I need a GetHired account to use it?",
      answer:
        "Yes. Sign in with your GetHired account so the extension can use your profile and primary resume. Set the resume you want to use as primary in your dashboard.",
    },
    {
      question: "Does the extension use AI credits?",
      answer:
        "Filling in standard fields doesn't. Each AI-written answer to an application question uses credits, as shown in your account. If you run out, you can buy more from your dashboard.",
    },
    {
      question: "Does it submit applications for me?",
      answer:
        "No. The extension fills in the form, and you review the answers and submit the application yourself.",
    },
  ],
  mcp: [
    {
      question: "What does the GetHired MCP Server do?",
      answer:
        "It connects your AI assistant to your GetHired account, so it can search and save jobs, apply on GetHired, and manage your resumes, resume reviews and mock interviews.",
    },
    {
      question: "Which AI assistant can connect to the MCP Server?",
      answer:
        "Any client that supports remote MCP servers, including Claude, Claude Code, Cursor and VS Code. You sign in with your GetHired account; there are no API keys. The setup page has the steps for each client.",
    },
    {
      question: "Can an AI assistant apply to jobs for me?",
      answer:
        "For jobs posted on GetHired, yes, but only after you confirm. Your client shows you the application before it is sent. Jobs posted elsewhere are applied to on the employer's own site.",
    },
    {
      question: "Does it cost anything?",
      answer:
        "Connecting is free. Tools that use AI, like improving a resume or a plain-English job search, spend AI credits from your balance, the same as in the app, and only once they run.",
    },
  ],
  "mcp-company": [
    {
      question: "What can a hiring team do over MCP?",
      answer:
        "What the recruiter agent can: write and publish job posts, search the talent pool, review applications, move people through your pipeline, import your own candidates, send messages, invite applicants to AI screening interviews, manage your team and edit your careers page.",
    },
    {
      question: "Who on my team can connect?",
      answer:
        "Anyone whose role has the \"Use GetHired from AI clients\" permission. Each tool then follows the rest of their role, including which jobs they're assigned to, so a connection can't do more than that person can in the app.",
    },
    {
      question: "Can the assistant email candidates or change things on its own?",
      answer:
        "No. Every tool that changes something or emails a candidate shows you what it will do and waits for you to confirm. Tools that email are also limited per hour.",
    },
    {
      question: "Does it cost extra?",
      answer:
        "No. There's no charge per call. Tools use your plan's allowances, the same as doing the work in the app.",
    },
    {
      question: "My client has a limit on tools. What do I do?",
      answer:
        "Add toolsets to the server URL to connect only some of them, for example ?toolsets=jobs,applicants, and readonly=true for a connection that can't change anything. The setup guide lists every toolset.",
    },
  ],
} as const;

export type FAQTopic = keyof typeof FAQS;

export type HowWeHelpAudience = "applicant" | "hire";

/** The "How we help" section: a heading and four feature cards, in card order. */
export function howWeHelpCopy(audience: HowWeHelpAudience, jobCount: number) {
  if (audience === "hire") {
    return {
      heading: "How We Revolutionize Your Hiring",
      subheading:
        "Connecting you with exceptional, pre-qualified talent with speed and unmatched precision.",
      features: [
        {
          name: "Personalized Candidate Discovery",
          description:
            "Stop wasting time on irrelevant job seeker profiles. Our advanced AI learns your preferences to bring you candidates you'll actually love",
        },
        {
          name: "Effortless Applicant Tracking",
          description: "Manage all your applications in one place",
        },
        {
          name: "AI Job Composer",
          description:
            "Create high-converting roles instantly. Our templates mandate key data to ensure clarity and attract only the most qualified, focused talent.",
        },
        {
          name: "Direct Talent Pipeline",
          description:
            "Manage your open roles and review pre-screened talent in one dashboard.",
        },
      ],
    };
  }
  return {
    heading: "Your AI job-search agent",
    subheading:
      "One chat for the whole search: finding roles, fixing your resume, practising interviews and keeping track of it all.",
    features: [
      {
        name: "Finds jobs that fit you",
        description:
          "Describe the role in plain English. It ranks the best matches for you.",
      },
      {
        name: "Keeps track of your applications",
        description:
          "Your applications, saved jobs and interviews, tracked in one chat.",
      },
      {
        name: "Searches every major job board",
        description: `Over ${jobCount.toLocaleString("en-US")} listings from Greenhouse, Workday, Ashby and more.`,
      },
      {
        name: "Gets you ready to apply",
        description:
          "Resumes improved for the job, plus AI mock interviews with feedback.",
      },
    ],
  };
}

/** The MCP server's public URL. */
export const MCP_SERVER_URL = `${SITE_URL}${MCP_PATH}`;

export type McpAudience = "applicant" | "company";

/** What each MCP landing page says the server does, in card order. */
export const MCP_CAPABILITIES: Record<
  McpAudience,
  { heading: string; subheading: string; items: readonly { name: string; description: string }[] }
> = {
  applicant: {
    heading: "What your assistant can do",
    subheading:
      "Your assistant works with your GetHired account directly, so you don't copy job posts or resumes between tabs.",
    items: [
      {
        name: "Search and save jobs",
        description:
          "Search by role, location and salary, or describe what you want in plain English. Get jobs matched to your profile and save the ones you like.",
      },
      {
        name: "Apply on GetHired",
        description:
          "Read a job's application form and apply to jobs posted on GetHired, once you've seen the application and confirmed it.",
      },
      {
        name: "Resumes",
        description:
          "Read your resumes, pick the best one for a job, set your primary resume and get changes to tailor it.",
      },
      {
        name: "Applications and interviews",
        description:
          "Track your applications, set up mock interviews, read their feedback and see your screening interviews.",
      },
    ],
  },
  company: {
    heading: "What your team's assistant can do",
    subheading:
      "The recruiter agent's tools, in the AI client your team already uses, within each person's role.",
    items: [
      {
        name: "Job posts",
        description: "Draft, edit and publish job posts and their application questions.",
      },
      {
        name: "Candidates and the talent pool",
        description:
          "Find matched candidates, search the pool, import your own candidates and add them to a job.",
      },
      {
        name: "Applications and the pipeline",
        description: "Review applications and notes, move people between stages and keep talent lists.",
      },
      {
        name: "Messages and AI interviews",
        description:
          "Send messages from your templates and invite applicants to AI screening interviews, once you confirm.",
      },
      {
        name: "Team and roles",
        description: "Invite teammates, manage roles and see who has access.",
      },
      {
        name: "Careers page",
        description: "Edit and publish your company's careers page.",
      },
    ],
  },
};

export type MarketingLink = { label: string; href: string };

export type LandingPageCopy = {
  /** The page's route; its markdown version is this plus `.md` (`/index.md` for `/`). */
  path: string;
  /** Meta description, also the markdown version's summary line. */
  description: string;
  heading: string;
  subheading: (jobCount: number) => string;
  /** The hero's buttons. An href of "#" is a label with no link yet ("Coming Soon"). */
  ctas: MarketingLink[];
  /** The "How we help" cards. The MCP pages show their capabilities instead. */
  howWeHelp?: HowWeHelpAudience;
  /** Set on the MCP landing pages: their capabilities and the server URL. */
  mcp?: McpAudience;
  faq: FAQTopic;
  /** Extra links for the markdown version only. */
  related?: MarketingLink[];
};

export type LandingPageKey =
  | "home"
  | "hire"
  | "mcp-server"
  | "mcp-server-companies"
  | "extension"
  | "ai-interview"
  | "ai-resume-checker";

export const LANDING_PAGES: Record<LandingPageKey, LandingPageCopy> = {
  home: {
    path: "/",
    description:
      "Find developer and tech jobs, including remote roles. Search current openings by role and location, then use GetHired's AI tools to focus your job search.",
    heading: "Your AI Agent for the Job Hunt",
    subheading: (jobCount) =>
      `Tell it what you're after. It searches ${jobCount.toLocaleString()} tech jobs, matches them to your resume, reviews your CV and preps you for interviews, all in one chat.`,
    ctas: [
      { label: "Chat with the agent", href: "/agent" },
      { label: "Hire Talent", href: "/hire" },
    ],
    howWeHelp: "applicant",
    faq: "job-search",
    related: [
      { label: "Browse jobs", href: "/jobs" },
      { label: "AI resume checker", href: "/ai-resume-checker" },
      { label: "AI interview practice", href: "/ai-interview" },
      { label: "MCP server", href: "/mcp-server" },
    ],
  },
  hire: {
    path: "/hire",
    description:
      "Post tech roles, review applicants, and use AI recruiting tools to help identify qualified candidates with GetHired.",
    heading: "Your AI Recruiter for Tech Hiring",
    subheading: () =>
      "Tell it who you need. It drafts your job post, ranks matched candidates, screens applicants with AI interviews and keeps your pipeline moving, all in one chat.",
    ctas: [
      { label: "Start hiring free", href: "/auth/sign-up?company=true" },
      { label: "Chat with the agent", href: COMPANY_AGENT_PATH },
    ],
    howWeHelp: "hire",
    faq: "hiring",
    related: [
      { label: "Plans and pricing", href: "/pricing/companies" },
      { label: "MCP server for hiring teams", href: "/mcp-server/companies" },
    ],
  },
  "mcp-server": {
    path: "/mcp-server",
    description:
      "Use GetHired from Claude, Cursor, VS Code or any MCP client: search and save jobs, apply, and manage your resumes, reviews and mock interviews with the GetHired MCP server.",
    heading: "GetHired in your AI assistant",
    subheading: (jobCount) =>
      `Connect Claude, Cursor, VS Code or any MCP client to your GetHired account. Search ${jobCount.toLocaleString("en-US")} tech jobs, apply, and work on your resume without leaving the chat.`,
    ctas: [
      { label: "Set up your client", href: "/mcp" },
      { label: "For hiring teams", href: "/mcp-server/companies" },
    ],
    mcp: "applicant",
    faq: "mcp",
    related: [
      { label: "Setup guide", href: "/mcp" },
      { label: "MCP server for hiring teams", href: "/mcp-server/companies" },
    ],
  },
  "mcp-server-companies": {
    path: "/mcp-server/companies",
    description:
      "Run your hiring from Claude, Cursor, VS Code or any MCP client: job posts, the talent pool, applications, the pipeline, messages and AI screening interviews with the GetHired MCP server.",
    heading: "Your hiring, in your AI assistant",
    subheading: () =>
      "Connect Claude, Cursor, VS Code or any MCP client to your company on GetHired. Post jobs, review applicants and move your pipeline from the chat, within each teammate's role.",
    ctas: [
      { label: "Set up your client", href: "/mcp#for-hiring-teams" },
      { label: "Start hiring free", href: "/auth/sign-up?company=true" },
    ],
    mcp: "company",
    faq: "mcp-company",
    related: [
      { label: "Setup guide", href: "/mcp" },
      { label: "Plans and pricing", href: "/pricing/companies" },
      { label: "MCP server for job seekers", href: "/mcp-server" },
    ],
  },
  extension: {
    path: "/extension",
    description:
      "Discover the GetHired Chrome Extension that fills Job Applications on any platform in a single click",
    heading: "GetHired Chrome Extension",
    subheading: () =>
      "Discover the GetHired Chrome Extension, a powerful tool designed to enhance your job application experience.",
    ctas: [{ label: "Coming Soon", href: "#" }],
    howWeHelp: "applicant",
    faq: "extension",
  },
  "ai-interview": {
    path: "/ai-interview",
    description:
      "Prepare for your next interview with our AI-powered practice sessions. Get personalized feedback and improve your chances of landing the job.",
    heading: "AI Interview",
    subheading: () =>
      "Prepare for your next interview with our AI-powered practice sessions. Get personalized feedback and improve your chances of landing the job.",
    ctas: [{ label: "Start Practicing", href: "/interview" }],
    howWeHelp: "applicant",
    faq: "ai-interview",
  },
  "ai-resume-checker": {
    path: "/ai-resume-checker",
    description:
      "Get a deep semantic analysis of your resume. GetHired's AI Resume Checker optimizes your technical presence for modern ATS systems to help you land more interviews.",
    heading: "AI Resume Checker",
    subheading: () =>
      "Optimizing your technical presence for the modern ATS. Join the list to get early access to deep semantic analysis.",
    ctas: [{ label: "Improve My Resume", href: agentPromptHref(IMPROVE_RESUME_PROMPT) }],
    howWeHelp: "applicant",
    faq: "resume",
  },
};

export const FOUNDER = { name: "Varun", url: "https://varun.devhub.co.in" };
export const CONTACT_EMAIL = "varun@devhub.co.in";
export const ABOUT_UPDATED = "October 9, 2026";

/** Follows "Hi, I'm {FOUNDER.name}." on the About and Contact pages. */
export const FOUNDER_INTRO =
  "I'm the founder of GetHired, a platform dedicated to helping job seekers find their dream jobs. With a passion for technology and a deep understanding of the job market, I created GetHired to provide users with the tools and resources they need to succeed in their careers.";

export const ABOUT_PARAGRAPHS = [
  "Why did I create GetHired? Summer of 2025 when I was job hunting, I realized how challenging it can be to navigate the job market. I wanted to create a platform that would simplify the process and provide users with valuable insights and resources to help them succeed.",
  "What's the future of GetHired? Currently we have AI integrated into the platform to help the users at each step of their job search journey. Moving forward I aim to make this platform truly agentic. We recently incorporated the AI Interview feature which is a positive step in that direction.",
];

export const ABOUT_DESCRIPTION =
  "GetHired is an AI job platform for tech jobs: an agent that searches openings, matches them to your resume, reviews your CV and preps you for interviews, plus hiring tools for companies.";
export const CONTACT_DESCRIPTION =
  "Questions, feedback or partnership ideas? Get in touch with the GetHired team.";
export const PRICING_DESCRIPTION =
  "Start hiring free on GetHired. Paid plans add more job posts, AI screening, outreach and AI interviews.";
export const PRICING_INTRO =
  "Post a job, see matched candidates and screen applicants for free. Paid plans add volume, team seats and AI interviews. Usage beyond your plan's allowances is paid with credits.";
export const BLOG_DESCRIPTION =
  "Practical job-search advice, career guidance, and product updates from GetHired.";

/** Pages with a markdown version at `<path>.md`, besides blog posts (`/blog/<slug>.md`). */
export const MARKDOWN_PAGES = [
  ...Object.values(LANDING_PAGES).map((p) => p.path),
  "/about",
  "/contact",
  "/pricing/companies",
  "/blog",
];

/** `/index.md` for the home page, `<path>.md` otherwise. */
export function markdownPath(path: string) {
  return path === "/" ? "/index.md" : `${path}.md`;
}

/** For a page's `metadata.alternates.types`, which adds `<link rel="alternate" type="text/markdown">`. */
export function markdownAlternate(path: string) {
  return { "text/markdown": markdownPath(path) };
}

/**
 * The page a `.md` request is for (`/hire.md` → `/hire`, `/index.md` → `/`), or
 * null when there's no markdown version of it.
 */
export function pageForMarkdownPath(pathname: string): string | null {
  if (!pathname.endsWith(".md")) return null;
  if (pathname === "/index.md") return "/";
  const page = pathname.slice(0, -".md".length);
  if (page !== "/" && MARKDOWN_PAGES.includes(page)) return page;
  if (/^\/blog\/[a-z0-9-]+$/.test(page)) return page;
  return null;
}
