// Copy shared by the marketing pages and their markdown versions (`/hire.md`,
// `/index.md`, ...), so the two can't drift. Client-safe: no server imports.

import { COMPANY_AGENT_PATH } from "@/helpers/agent/prompt-draft";

export const SITE_URL = "https://gethired.devhub.co.in";

export const FAQS = {
  "job-search": [
    {
      question: "What is the GetHired agent?",
      answer:
        "An AI assistant you chat with. It searches jobs, finds roles matched to your resume, tracks your applications, starts resume reviews and sets up mock interviews. It asks before changing your profile, and AI features use credits as shown in your account.",
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
        "The GetHired MCP Server connects compatible AI assistants to job-search features, including personalized recommendations and resume tools.",
    },
    {
      question: "Which AI assistant can connect to the MCP Server?",
      answer:
        "GetHired's MCP Server is designed to integrate with Claude. Check the setup instructions for current compatibility and configuration.",
    },
    {
      question: "Can an AI assistant apply to jobs for me?",
      answer:
        "The MCP Server supports job-search assistance. Review each job's application process and submit applications through the employer's specified channel.",
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
          "Resume reviews against the job, plus AI mock interviews with feedback.",
      },
    ],
  };
}

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
  howWeHelp: HowWeHelpAudience;
  faq: FAQTopic;
  /** Extra links for the markdown version only. */
  related?: MarketingLink[];
};

export type LandingPageKey =
  | "home"
  | "hire"
  | "mcp-server"
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
    related: [{ label: "Plans and pricing", href: "/pricing/companies" }],
  },
  "mcp-server": {
    path: "/mcp-server",
    description:
      "Connect Claude to GetHired job-search tools for personalized job recommendations and resume support with the GetHired MCP Server.",
    heading: "GetHired MCP Server",
    subheading: () =>
      "Discover the GetHired MCP Server, a powerful tool designed to enhance your job search experience.",
    ctas: [
      { label: "Get Started", href: "https://github.com/kVarunkk/GetHired-mcp-server" },
      { label: "Learn More", href: "/blog/introducing-the-get-hired-mcp-server" },
    ],
    howWeHelp: "applicant",
    faq: "mcp",
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
    ctas: [{ label: "Review My Resume", href: "/resume-review" }],
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
