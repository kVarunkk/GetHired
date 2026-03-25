import { Enums, Json, Tables } from "./types/database.types";

// export interface IJobResult {
//   score?: number;
//   suitable?: boolean;
//   description?: string;
//   cover_letter?: string;
//   applied?: boolean;
//   application_url?: string;
// }

// export interface IPlatform {
//   id: string;
//   created_at: string;
//   updated_at: string;
//   name: string;
//   slug: string;
//   auto_apply_available: boolean;
//   fields: IPlatformField[];
// }

// export interface IPlatformField {
//   id: string;
//   name: string;
//   type: "text" | "textarea" | "password";
//   label: string;
//   required: boolean;
//   placeholder?: string;
//   tooltip?: {
//     text: string;
//     linkText?: string;
//     linkHref?: string;
//   };
// }

// export interface IJobFeedback {
//   id: string;
//   created_at: string;
//   updated_at: string;
//   user_id: string;
//   job_id: string;
//   vote_type: "upvote" | "downvote";
// }

// export interface IJob {
//   id: string;
//   job_name: string;
//   company_name: string;
//   company_url: string;
//   job_type: string;
//   salary_range: string;
//   salary_min: number;
//   salary_max: number;
//   experience: string;
//   experience_min: number;
//   experience_max: number;
//   equity_range: string;
//   equity_min: number;
//   equity_max: number;
//   visa_requirement: string;
//   description: string;
//   job_url: string | null;
//   created_at: string;
//   updated_at: string;
//   locations: string[];
//   platform: string;
//   user_favorites: {
//     id: string;
//     created_at: string;
//     updated_at: string;
//     user_id: string;
//     job_id: string;
//   }[];
//   job_postings?: IJobPosting[];
//   applications?: IApplication[];
//   status: "active" | "inactive";
//   ai_summary?: string;
//   job_feedback?: IJobFeedback[];
// }

// type AllJobsRow = Database["public"]["Tables"]["all_jobs"]["Row"];
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
// type UserRelevantJobsRow =
//   Database["public"]["Tables"]["user_relevant_jobs"]["Row"];
// type UserFavoritesRow = Database["public"]["Tables"]["user_favorites"]["Row"];
// type ApplicationsRow = Database["public"]["Tables"]["applications"]["Row"];
// export type JobPostingsRow =
//   Database["public"]["Tables"]["job_postings"]["Row"];
// type CompanyInfoRow = Database["public"]["Tables"]["company_info"]["Row"];
// type JobFeedbackRow = Database["public"]["Tables"]["job_feedback"]["Row"];
// type UserFavoritesCompanyInfoRow =
//   Database["public"]["Tables"]["user_favorites_companies"]["Row"];
// export type TJobTypeEnum = Database["public"]["Enums"]["job_type_enum"];
// export type TBookmark = Database["public"]["Tables"]["bookmarks"]["Row"];
// export type TPricePlan = Database["public"]["Tables"]["price_plan"]["Row"];

export type TCompanyInfo = CompanyInfoRow & {
  user_favorites_companies?: UserFavoritesCompanyInfoRow[];
};

export type AllProfileWithRelations = UserInfoRow & {
  // user_favorites: UserFavoritesRow[];
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

// export type IJob = AllJobsRow & {
//   user_favorites: UserFavoritesRow[];
//   job_postings?: IJobPosting[];
//   applications?: ApplicationsRow[];
//   job_feedback?: IJobFeedback[];
// };

// export interface IJobPosting {
//   id: string;
//   title: string;
//   description: string;
//   job_type: "Fulltime" | "Intern" | "Contract";
//   salary_currency: string;
//   min_salary: number;
//   max_salary: number;
//   salary_range: string;
//   min_experience: number;
//   max_experience?: number;
//   experience: string;
//   visa_sponsorship: "Not Required" | "Required" | "Will Sponsor";
//   location: string[];
//   min_equity?: number;
//   max_equity?: number;
//   equity_range: string;
//   company_id: string;
//   created_at: string;
//   updated_at: string;
//   status: "active" | "inactive";
//   company_info?: ICompanyInfo;
//   applications?: IApplication[];
//   questions: string[];
//   job_id: string | null;
// }

// export interface IInvitation {
//   id: string;
//   created_at: string;
//   updated_at: string;
//   referrer_user_id: string;
//   invited_email: string;
//   status: "pending" | "complete";
// }

// export interface IFormData {
//   user_id?: string;
//   full_name: string;
//   email: string;
//   desired_roles: string[];
//   preferred_locations: string[];
//   salary_currency: string;
//   min_salary: number | "";
//   max_salary: number | "";
//   experience_years: number | "";
//   industry_preferences: string[];
//   visa_sponsorship_required: boolean;
//   top_skills: string[];
//   work_style_preferences: string[];
//   career_goals_short_term: string;
//   career_goals_long_term: string;
//   company_size_preference: string;
//   resume_file: File | null;
//   resume_id: string | null;
//   resumes?: IResume[];
//   is_public?: boolean;
//   default_locations: string[];
//   job_type: string[];
//   company_favorites?: {
//     id: string;
//     created_at: string;
//     updated_at: string;
//     user_info_id: string;
//     company_id: string;
//   }[];
//   applications?: IApplication[];
//   is_promotion_active?: boolean;
//   is_job_digest_active?: boolean;
//   ai_credits?: number;
//   linkedin_url?: string;
//   github_url?: string;
//   invitations?: IInvitation[];
// }

// export interface ICompanyInfo {
//   id: string;
//   user_id: string;
//   name: string;
//   description: string;
//   website: string;
//   industry: string;
//   headquarters: string;
//   company_size: string;
//   logo_url: string;
//   tag_line: string;
//   created_at: string;
//   updated_at: string;
//   ai_credits: number;
//   filled: boolean;
//   user_favorites_companies: {
//     id: string;
//     created_at: string;
//     updated_at: string;
//     user_id: string;
//     company_id: string;
//   }[];
// }

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

// export interface IApplication {
//   id: string;
//   job_post_id: string;
//   applicant_user_id: string;
//   user_info?: IFormData;
//   job_postings?: IJobPosting;
//   status: TApplicationStatus;
//   resume_url: string;
//   resumes?: IResume;
//   created_at: string;
//   answers: string[];
// }

// export interface IBookmark {
//   id: string;
//   created_at: string;
//   updated_at: string;
//   user_id: string;
//   url: string;
//   name: string;
//   is_alert_on: boolean;
// }

// export interface IPricePlan {
//   id: string;
//   product_id: string;
//   credit_amount: number;
//   amount: number;
//   currency: string;
//   name: string;
//   description: string;
// }

// export interface IPayment {
//   id: string;
//   user_id: string;
//   created_at: string;
//   updated_at: string;
//   status: TPaymentStatus;
//   price_plan_id: string;
//   credit_amount: number;
//   currency: string;
//   credits_fulfilled: boolean;
//   fulfillment_date: string | null;
//   session_id: string;
//   product_id: string;
//   payment_id: string | null;
//   failure_reason: string | null;
//   total_amount: number;
//   price_plan?: IPricePlan;
//   customer: Customer;
//   billing: BillingAddress;
//   payment_method: string;
// }

// export interface IResume {
//   id: string;
//   user_id?: string;
//   created_at?: string;
//   updated_at?: string;
//   name?: string;
//   resume_path?: string;
//   content?: {
//     sections?: {
//       type?: string;
//       items?: {
//         bullets?: {
//           id?: string;
//           text?: string;
//           lineIndices?: string[];
//         }[];
//         heading?: string;
//         subheading?: string;
//       }[];
//     }[];
//   };
//   is_primary?: boolean;
//   parsing_failed?: boolean;
// }

// export interface IResumeReview {
//   id: string;
//   user_id: string;
//   created_at: string;
//   updated_at: string;
//   resume_id: string;
//   job_id: string;
//   resumes?: IResume;
//   ai_response?: {
//     overall_feedback?: string;
//     score?: string;
//     bullet_points?: {
//       bullet_id: string;
//       section: string;
//       original: string;
//       suggested: string;
//       reason: string;
//       priority: string;
//     }[];
//   };
//   target_jd: string;
//   status: TPaymentStatus;
//   name: string;
//   score: number;
// }

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

// export enum TLimits {
//   RESUME = 8,
// }

export enum TWaitlistType {
  AI_RESUME_CHECKER = "ai_resume_checker",
}

export interface JobListingSearchParams {
  jobTitleKeywords?: string;
  location?: string;
  jobType?: string;
  minSalary?: string;
  // Add any other filter parameters here
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
  //  {
  //   id: string;
  //   created_at: string;
  //   updated_at: string;
  //   user_id: string;
  // }

  // company_id: string | null;
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
