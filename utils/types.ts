import { Enums, Json, Tables } from "./types/database.types";

type AllJobsRow = Tables<"all_jobs">;
type UserRelevantJobsRow = Tables<"user_relevant_jobs">;
type UserFavoritesRow = Tables<"user_favorites">;
type ApplicationsRow = Tables<"applications">;
export type JobPostingsRow = Tables<"job_postings">;
type CompanyInfoRow = Tables<"company_info">;
type JobFeedbackRow = Tables<"job_feedback">;
type UserFavoritesCompanyInfoRow = Tables<"user_favorites_companies">;
export type TJobTypeEnum = Enums<"job_type_enum">;
export type BookmarkRow = Tables<"bookmarks">;
export type PaymentsRow = Tables<"payments">;
export type PricePlanRow = Tables<"price_plan">;
type UserInfoRow = Tables<"user_info">;
export type TJobFeedbackVoteEnum = Enums<"job_feedback_vote">;

export type TCompanyInfo = CompanyInfoRow & {
  user_favorites_companies?: UserFavoritesCompanyInfoRow[];
};

export type AllProfileWithRelations = UserInfoRow & {
  company_favorites?: UserFavoritesCompanyInfoRow[];
};

export type ProfilesBuildQueryResult = {
  data: AllProfileWithRelations[];
  error: string | null | undefined;
  nextCursor: string | null;
  count: number;
  matchedProfileIds: string[];
};

export type AllJobWithRelations = AllJobsRow & {
  user_relevant_jobs?: UserRelevantJobsRow[];
  user_favorites: UserFavoritesRow[];
  applications: ApplicationsRow[];
  job_postings?: (JobPostingsRow & {
    company_info: CompanyInfoRow | null;
    applications: ApplicationsRow[];
  })[];
  job_feedback?: JobFeedbackRow[];
};

export type JobsBuildQueryResult = {
  data: AllJobWithRelations[];
  error: string | null | undefined;
  nextCursor: string | null;
  count: number;
  matchedJobIds: string[];
};

export type AIRerankJob = {
  id: string;
  job_name: string | null;
  description: string | null;
  visa_requirement: string | null;
  salary_range: string | null;
  locations: string[] | null;
  experience: string | null;
};

export type AIRerankRequestBody = {
  userId: string;
  jobs: AIRerankJob[];
  jobId?: string;
  aiCredits?: number;
};

export type TResumeRowContent = {
  sections?: {
    type?: string;
    items?: {
      bullets?: {
        id?: string;
        text?: string;
        lineIndices?: string[];
      }[];
      heading?: string;
      subheading?: string;
    }[];
  }[];
};

export interface IJobPost
  extends Omit<JobPostingsRow, "applications" | "company_info"> {
  applications?: { count: number }[];
  company_info?: {
    name: string | null;
    website: string | null;
  };
}

export interface ICountry {
  country: string;
  cities: string[];
  iso: string;
}

export interface ICreateJobPostingFormData {
  id?: string;
  title: string;
  description: string;
  job_type: TJobTypeEnum;
  salary_currency: string;
  min_salary: number;
  max_salary: number;
  min_experience: number;
  visa_sponsorship: "Not Required" | "Required" | "Will Sponsor";
  location: string[];
  max_experience?: number;
  min_equity?: number;
  max_equity?: number;
  questions?: string[];
}

export interface INavItem {
  id: string;
  label: string;
  href: string;
  type: "equals" | "includes" | "startswith";
  icon?: React.ReactNode;
}

export interface INavItemWithActive extends INavItem {
  active: boolean;
}

export enum TApplicationStatus {
  SUBMITTED = "submitted",
  REVIEWED = "reviewed",
  SELECTED = "selected",
  STAND_BY = "stand_by",
  REJECTED = "rejected",
}

export enum TPaymentStatus {
  COMPLETE = "complete",
  FAILED = "failed",
  PENDING = "pending",
  CANCELLED = "cancelled",
}

export enum TResumeReviewStatus {
  DRAFT = "draft",
  COMPLETED = "completed",
  FAILED = "failed",
}

export enum TAICredits {
  AI_SEARCH_ASK_AI_RESUME = 3,
  AI_SUMMARY = 1,
  AI_CV_REVIEW = 5,
}

export enum TWaitlistType {
  AI_RESUME_CHECKER = "ai_resume_checker",
}

export interface JobListingSearchParams {
  jobTitleKeywords?: string;
  location?: string;
  jobType?: string;
  minSalary?: string;
}

export type FiltersState = {
  jobType: string[];
  location: string[];
  visaRequirement: string[];
  minSalary: string;
  minExperience: string;
  platform: string[];
  companyName: string[];
  jobTitleKeywords: string[];
  jobRole: string[];
  industryPreference: string[];
  workStylePreference: string[];
  skills: string[];
  maxSalary?: string;
  applicationStatus: TApplicationStatus;
  industry?: string[];
  name?: string[];
  size?: string[];
  createdAfter: string[];
};

export interface FilterConfig {
  name: keyof FiltersState;
  label: string;
  type: "text" | "number" | "multi-select" | "multi-select-input";
  placeholder?: string;
  options?: { value: string; label: string }[];
  isVirtualized?: boolean;
  hidden?: boolean;
  isSingleSelect?: boolean;
}

export interface BaseFavorite {
  created_at: string;
  id: string;
  updated_at: string | null;
  user_id: string | null;
}

export interface IUserFavorites extends BaseFavorite {
  job_id: string | null;
}

export interface IUserFavoritesCompanyInfo extends BaseFavorite {
  company_id: string | null;
}

export type TResumeContent = {
  experience: string;
  skills: string;
  projects: string;
};

export type JsonCompatible<T> = T & { [key: string]: Json | undefined };
