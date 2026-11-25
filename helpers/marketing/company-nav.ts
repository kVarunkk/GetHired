// The /hire/<feature> pages as footer links. Kept apart from company-pages.ts
// so the footer (a client component) doesn't ship every page's copy;
// company-nav.test.ts checks the two lists name the same pages.

export const COMPANY_NAV = [
  { href: "/hire/ai-recruiter-agent", label: "AI Recruiter Agent" },
  { href: "/hire/ai-job-description-generator", label: "AI Job Description Generator" },
  { href: "/hire/ai-candidate-matching", label: "AI Candidate Matching" },
  { href: "/hire/talent-pool", label: "Talent Pool" },
  { href: "/hire/candidate-outreach", label: "Candidate Outreach" },
  { href: "/hire/ai-applicant-screening", label: "AI Applicant Screening" },
  { href: "/hire/ai-screening-interviews", label: "AI Screening Interviews" },
  { href: "/hire/applicant-tracking-system", label: "Applicant Tracking System" },
  { href: "/hire/interview-scheduling", label: "Interview Scheduling" },
  { href: "/hire/careers-page-builder", label: "Careers Page Builder" },
  { href: "/hire/job-multiposting", label: "Job Multiposting" },
  { href: "/hire/hiring-team-collaboration", label: "Hiring Team Collaboration" },
] as const;
