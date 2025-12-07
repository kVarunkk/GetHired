import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

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

export const fetcher = (url: string) => fetch(url).then((res) => res.json());
