import { clsx, type ClassValue } from "clsx";
import {
  Bot,
  FileUser,
  Headset,
  Info,
  ScanSearch,
  Settings,
  Sparkle,
  UserIcon,
} from "lucide-react";

import toast from "react-hot-toast";
import { twMerge } from "tailwind-merge";
import { Briefcase, Building2, Home, LayoutDashboard } from "lucide-react";
import { INavItem } from "./types";
import { User } from "@supabase/supabase-js";
import { platformsArray } from "./platforms";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// This check can be removed, it is just for tutorial purposes
export const hasEnvVars =
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const commonSkills = [
  "Project Management",
  "Data Analysis",
  "Software Development",
  "Cloud Computing",
  "Cybersecurity",
  "Digital Marketing",
  "Content Creation",
  "Financial Modeling",
  "Customer Service",
  "Sales",
  "Communication",
  "Leadership",
  "Problem Solving",
  "Critical Thinking",
  "Adaptability",
  "Teamwork",
  "Time Management",
  "Public Speaking",
  "Negotiation",
  "Research",
  "UX/UI Design",
  "Mobile Development",
  "Machine Learning",
  "Artificial Intelligence",
  "Business Development",
  "Strategic Planning",
  "Data Visualization",
  "SQL",
  "Python",
  "JavaScript",
  "React",
  "Node.js",
];

export const commonJobTitles = [
  "Software Engineer",
  "Product Manager",
  "Data Scientist",
  "DevOps Engineer",
  "UI/UX Designer",
  "Marketing Specialist",
  "Sales Manager",
  "Front End Developer",
  "Back End Developer",
  "JavaScript Developer",
  "Fullstack Developer",
  "Project Manager",
  "Business Analyst",
  "Financial Analyst",
  "Accountant",
  "Human Resources Manager",
  "Customer Service Representative",
  "Operations Manager",
  "Data Analyst",
  "Cybersecurity Analyst",
  "Network Engineer",
  "System Administrator",
  "Technical Writer",
  "Content Creator",
  "Graphic Designer",
  "Digital Marketing Manager",
  "Recruiter",
  "Legal Counsel",
  "Research Scientist",
  "Quality Assurance Engineer",
  "Cloud Engineer",
  "Machine Learning Engineer",
  "Database Administrator",
  "IT Support Specialist",
  "Executive Assistant",
  "Copywriter",
  "Social Media Manager",
  "Supply Chain Manager",
  "Consultant",
  "Architect",
  "Civil Engineer",
  "Mechanical Engineer",
  "Electrical Engineer",
];

export const commonIndustries = [
  "Technology",
  "Finance",
  "Healthcare",
  "Education",
  "Manufacturing",
  "Retail",
  "Marketing & Advertising",
  "Media & Entertainment",
  "Hospitality",
  "Automotive",
  "Aerospace & Defense",
  "Energy & Utilities",
  "Construction",
  "Real Estate",
  "Consulting",
  "Biotechnology",
  "Pharmaceuticals",
  "Telecommunications",
  "Transportation & Logistics",
  "Government & Public Sector",
  "Non-profit",
  "Food & Beverage",
  "Fashion & Apparel",
  "Sports",
  "Environmental Services",
  "Legal",
  "Agriculture",
  "E-commerce",
  "Gaming",
  "Cybersecurity",
];

export const commonWorkStyles = [
  "Remote",
  "Hybrid",
  "On-site",
  "Startup Environment",
  "Large Corporate Environment",
  "Fast-paced",
  "Relaxed Pace",
  "Collaborative",
  "Independent Work",
  "Flexible Hours",
  "Structured Environment",
  "Innovative Culture",
  "Stable Environment",
  "Customer-Facing",
  "Behind-the-Scenes",
  "Results-Oriented",
  "Process-Driven",
  "Team-Oriented",
  "Autonomous",
  "Travel Required",
];

/**
 * Calculates the time remaining until the next 00:05 UTC reset, rounded up to the nearest hour.
 * @returns Number of hours remaining (e.g., 10).
 */
export function getTimeLeftHours(): number {
  const now = new Date();
  const nextReset = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 1,
      0, // 00 hours
      5, // 05 minutes
      0,
    ),
  );

  const diffMs = nextReset.getTime() - now.getTime();

  // Calculate hours and round up (ceil)
  const hours = Math.ceil(diffMs / (1000 * 60 * 60));

  // Ensure the minimum return value is 0 (or 24 if just reset)
  return Math.max(0, hours);
}

export function currentPathEncoded() {
  if (typeof window === "undefined") return "/";

  // Get the full path including search parameters (e.g., /jobs?filter=true)
  const fullPath = window.location.pathname + window.location.search;

  // IMPORTANT: Use encodeURIComponent to ensure characters like & or ? don't break the URL.
  return encodeURIComponent(fullPath);
}

export function isValidUrl(url_string: string) {
  try {
    new URL(url_string);
    return true;
  } catch {
    return false;
  }
}

export const formatCurrency = (amount: number, currency: string) => {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency,
      minimumFractionDigits: 2,
    }).format(amount / 100); // Amount is usually in cents/paise
  } catch {
    return `${amount / 100} ${currency?.toUpperCase() ?? ""}`;
  }
};

export const fetcher = (url: string) => fetch(url).then((res) => res.json());
export const PROFILE_API_KEY = "/api/current-user";
export const JOB_POSTING_API_KEY = "/api/job-posting";
export const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export const copyToClipboard = (content: string, toastMessage: string) => {
  if (content && toastMessage) {
    navigator.clipboard.writeText(content);
    toast.success(toastMessage);
  }
};

export function getCutOffDateClient(daysAgo: number): string {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString();
}

export function getDaysFromDate(encodedDateStr: string): number {
  // 1. Decode the URI characters (e.g., %3A -> :)
  const decodedDate = decodeURIComponent(encodedDateStr);

  // 2. Parse the target date and current date
  const targetDate = new Date(decodedDate);
  const today = new Date();

  // 3. Normalize both to UTC midnight to compare full days accurately
  const utcTarget = Date.UTC(
    targetDate.getUTCFullYear(),
    targetDate.getUTCMonth(),
    targetDate.getUTCDate(),
  );

  const utcToday = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
  );

  // 4. Calculate difference in milliseconds and convert to days
  const diffInMs = utcToday - utcTarget;
  return Math.floor(diffInMs / (1000 * 60 * 60 * 24));
}

export const applicantNavbarItems: INavItem[] = [
  {
    id: "agent",
    label: "Agent",
    href: "/agent",
    type: "startswith",
    icon: <Bot className="h-4 w-4" />,
  },
  {
    id: "dashboard",
    label: "Dashboard",
    href: "/dashboard",
    type: "startswith",
    icon: <LayoutDashboard className="h-4 w-4" />,
  },
  {
    id: "jobs",
    label: "Jobs",
    href: "/jobs",
    type: "startswith",
    icon: <Briefcase className="h-4 w-4" />,
  },
  {
    id: "interviews",
    label: "Interviews",
    href: "/interview",
    type: "startswith",
    icon: <Headset className="h-4 w-4" />,
  },
  {
    id: "reviews",
    label: "CV Reviews",
    href: "/resume-review",
    type: "startswith",
    icon: <ScanSearch className="h-4 w-4" />,
  },
  {
    id: "resumes",
    label: "Resumes",
    href: "/resume",
    type: "startswith",
    icon: <FileUser className="h-4 w-4" />,
  },
  // {
  //   id: "companies",
  //   label: "Companies",
  //   href: "/companies",
  //   type: "startswith",
  //   icon: <Building2 className="h-4 w-4" />,
  // },
];

export const companyNavbarItems: INavItem[] = [
  {
    id: "home",
    label: "Home",
    href: "/company",
    type: "equals",
    icon: <Home className="h-4 w-4" />,
  },
  {
    id: "agent",
    label: "Agent",
    href: "/company/agent",
    type: "startswith",
    icon: <Bot className="h-4 w-4" />,
  },
  {
    id: "job_posts",
    label: "Job Posts",
    href: "/company/job-posts",
    type: "startswith",
    icon: <Briefcase className="h-4 w-4" />,
  },
  {
    id: "applicants",
    label: "Applicants",
    href: "/company/applicants",
    type: "startswith",
    icon: <FileUser className="h-4 w-4" />,
  },
  {
    id: "profiles",
    label: "Profiles",
    href: "/company/profiles",
    type: "startswith",
    icon: <UserIcon className="h-4 w-4" />,
  },
  {
    id: "settings",
    label: "Settings",
    href: "/company/settings",
    type: "startswith",
    icon: <Settings className="h-4 w-4" />,
  },
];

export const homePageNavItems: INavItem[] = [
  {
    id: "agent",
    label: "Agent",
    href: "/agent",
    type: "startswith",
  },
  {
    id: "jobs",
    label: "Jobs",
    href: "/jobs",
    type: "startswith",
  },
  {
    id: "interview",
    label: "AI Interview",
    href: "/ai-interview",
    type: "startswith",
  },
  {
    id: "cvreview",
    label: "CV Review",
    href: "/ai-resume-checker",
    type: "includes",
  },
  {
    id: "hire",
    label: "Hire",
    href: "/hire",
    type: "includes",
  },
];

export const authPageNavItems: INavItem[] = [
  {
    id: "home",
    label: "Home",
    href: "/",
    type: "equals",
  },
  ...homePageNavItems,
];

const verticalNavbarPaths = [
  "/dashboard",
  "/company",
  "/jobs",
  "/companies",
  "/get-started",
  "/resume-review",
  "/resume",
  "/interview",
  "/agent",
];

export const noScrollToTop = ["/resume-review/"];

// Pages that take exactly the viewport height (below the navbar on phones)
// and scroll inside themselves instead of scrolling the page.
export const fullHeightPaths = ["/agent", "/company/agent"];

export const getNavItemsByPath = (
  path: string,
  isCompanyUser: boolean,
  user: User | null = null,
): INavItem[] => {
  if (user && !isCompanyUser) {
    return applicantNavbarItems;
  } else if (user && isCompanyUser) {
    return companyNavbarItems;
  } else if (path.startsWith("/auth")) {
    return authPageNavItems;
  } else if (verticalNavbarPaths.some((p) => path.startsWith(p))) {
    return applicantNavbarItems; // Default to applicantNavbarItems for vertical paths if user is not logged in
  } else {
    return homePageNavItems;
  }
};

export const getNavbarVairantByPath = (
  path: string,
): "horizontal" | "vertical" => {
  if (verticalNavbarPaths.some((p) => path.startsWith(p))) {
    return "vertical";
  } else {
    return "horizontal";
  }
};

export const featureData = {
  title: "Applying to Jobs Just Got Easier with Ask AI!",
  description:
    "Introducing our new Ask AI feature! Get personalized, ready-to-paste answers for tricky application and interview questions. The AI synthesizes your unique profile (skills, projects) directly with the job requirements.",
  confirmButtonLabel: "Dismiss",
  // featureHighlight:
  //   "Instantly generate custom answers that relate your experience directly to the job description.",
  promoImage: "/Screenshot 2025-12-02 191053.png", // Suggested new path for better context
  // Provide concrete examples of questions the user can now answer effortlessly
  customContent: (
    <div className="flex items-center gap-3 rounded-md bg-secondary p-3 border border-border">
      <Info className="h-4 w-4 shrink-0" />
      <p className="text-sm">
        Use the{" "}
        <span className="font-bold inline-flex  gap-1">
          <Sparkle className="h-4 w-4" /> Ask AI
        </span>{" "}
        feature on any job listing to get assistance with your application.
      </p>
    </div>
  ),
  currentDialogId: "AI_PREP_QANDA_V1", // New, unique ID for this feature tour
};

export const HeroMaskStyle = {
  maskImage: "linear-gradient(to bottom, black 70%, transparent 100%)",
  WebkitMaskImage: "linear-gradient(to bottom, black 70%, transparent 100%)",
};

export const cloudFrontUrl = process.env.NEXT_PUBLIC_CLOUDFRONT_PATH || "";

export const JOB_SEEKER_DARK = `${cloudFrontUrl}/hero/job-seeker-hero-dark.webp`;
export const JOB_SEEKER_LIGHT = `${cloudFrontUrl}/hero/job-seeker-hero-light.webp`;
export const HIRE_PAGE_DARK = `${cloudFrontUrl}/hero/company-hero-dark.webp`;
export const HIRE_PAGE_LIGHT = `${cloudFrontUrl}/hero/company-hero-light.webp`;
export const MCP_SERVER_DARK = `${cloudFrontUrl}/hero/mcp-server-hero-dark.webp`;
export const MCP_SERVER_LIGHT = `${cloudFrontUrl}/hero/mcp-server-hero-light.webp`;
export const CHROME_EXTENSION_DARK = `${cloudFrontUrl}/hero/chrome-extension-hero-dark.webp`;
export const CHROME_EXTENSION_LIGHT = `${cloudFrontUrl}/hero/chrome-extension-hero-light.webp`;
export const RESUME_CHECKER_DARK = `${cloudFrontUrl}/hero/dark-ai-resume-checker.webp`;
export const RESUME_CHECKER_LIGHT = `${cloudFrontUrl}/hero/light-ai-resume-checker.webp`;
export const AI_INTERVIEW_DARK = `${cloudFrontUrl}/hero/ai-interview-dark.webp`;
export const AI_INTERVIEW_LIGHT = `${cloudFrontUrl}/hero/ai-interview-light.webp`;
export const BRAND_LONG_LIGHT = `${cloudFrontUrl}/brand/long-light.webp`;
export const BRAND_LONG_DARK = `${cloudFrontUrl}/brand/long-dark.webp`;
export const BRAND_SHORT_LIGHT = `${cloudFrontUrl}/brand/short-light.webp`;
export const BRAND_SHORT_DARK = `${cloudFrontUrl}/brand/short-dark.webp`;

// Logos shown on the landing page, one per supported job platform.
export const platforms = platformsArray
  .filter((platform) => platform.value !== "gethired")
  .map((platform) => ({
    id: platform.value,
    name: platform.label,
    src: `${cloudFrontUrl}/brands/${platform.value}.webp`,
    href: `/jobs?platform=${platform.value}`,
  }));

export const DEFAULT_CITIES = [
  { location: "Remote" },
  { location: "San Francisco" },
  { location: "New York" },
  { location: "London" },
  { location: "Bengaluru" },
  { location: "Singapore" },
  { location: "Berlin" },
  { location: "Toronto" },
  { location: "Dubai" },
  { location: "Amsterdam" },
  { location: "Dublin" },
  { location: "Tokyo" },
  { location: "Sydney" },
  { location: "Mumbai" },
  { location: "Delhi" },
  { location: "Austin" },
  { location: "Seattle" },
  { location: "Los Angeles" },
  { location: "Vancouver" },
  { location: "Paris" },
  { location: "Stockholm" },
  { location: "Zurich" },
  { location: "Melbourne" },
  { location: "Hong Kong" },
  { location: "Brazil" },
  { location: "Buenos Aires" },
  { location: "Bogota" },
  { location: "Lagos" },
  { location: "Cape Town" },
  { location: "Nairobi" },
];

