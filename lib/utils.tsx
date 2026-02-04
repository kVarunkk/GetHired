import { clsx, type ClassValue } from "clsx";
import { FileUser, Info, ScanSearch, Sparkle, User } from "lucide-react";

import toast from "react-hot-toast";
import { twMerge } from "tailwind-merge";
import { Briefcase, Building2, Home, LayoutDashboard } from "lucide-react";
import { INavItem } from "./types";
// import { INavItem } from "@/components/NavbarParent";

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
      0
    )
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
    targetDate.getUTCDate()
  );

  const utcToday = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate()
  );

  // 4. Calculate difference in milliseconds and convert to days
  const diffInMs = utcToday - utcTarget;
  return Math.floor(diffInMs / (1000 * 60 * 60 * 24));
}

export const applicantNavbarItems: INavItem[] = [
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
  {
    id: "companies",
    label: "Companies",
    href: "/companies",
    type: "startswith",
    icon: <Building2 className="h-4 w-4" />,
  },
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
    icon: <User className="h-4 w-4" />,
  },
];

export const homePageNavItems: INavItem[] = [
  {
    id: "jobs",
    label: "Jobs",
    href: "/jobs",
    type: "startswith",
  },
  {
    id: "companies",
    label: "Companies",
    href: "/companies",
    type: "startswith",
  },
  {
    id: "features",
    label: "Features",
    href: "#howwehelp",
    type: "includes",
  },
  {
    id: "blog",
    label: "Blog",
    href: "/blog",
    type: "includes",
  },
  {
    id: "hire",
    label: "Hire",
    href: "/hire",
    type: "includes",
  },
  {
    id: "cvreview",
    label: "CV Review",
    href: "/ai-resume-checker",
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

export const getNavItemsByPath = (
  path: string,
  isCompanyUser: boolean
): INavItem[] => {
  if (
    path.startsWith("/dashboard") ||
    path.startsWith("/jobs") ||
    path.startsWith("/companies") ||
    path.startsWith("/get-started") ||
    path.startsWith("/resume-review") ||
    path.startsWith("/resume")
  ) {
    if (isCompanyUser) {
      return companyNavbarItems;
    }
    return applicantNavbarItems;
  } else if (path.startsWith("/company")) {
    return companyNavbarItems;
  } else if (path.startsWith("/auth")) {
    return authPageNavItems;
  } else return homePageNavItems;
};

export const getNavbarVairantByPath = (
  path: string
): "horizontal" | "vertical" => {
  if (
    path.startsWith("/dashboard") ||
    path.startsWith("/company") ||
    path.startsWith("/jobs") ||
    path.startsWith("/companies") ||
    path.startsWith("/get-started") ||
    path.startsWith("/resume-review") ||
    path.startsWith("/resume")
  ) {
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
