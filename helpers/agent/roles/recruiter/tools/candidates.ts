import { tool } from "ai";
import { after } from "next/server";
import { z } from "zod";
import { wrapInSandbox } from "@/helpers/ai/security";
import { scrubPII } from "@/helpers/ai/fairness";
import { searchProfiles } from "@/helpers/profiles/search-profiles";
import { loadVisibleCandidates } from "@/helpers/profiles/visible-candidates";
import { getCandidateMatches } from "@/helpers/matching/candidate-matches";
import { parseStoredExplanation, type MatchExplanation } from "@/helpers/matching/schemas";
import { triggerJobPostingRelevanceUpdate } from "@/app/actions/relevant-profiles-update";
import type { TResumeRowContent } from "@/utils/types";
import { AGENT_LIST_DEFAULT_LIMIT } from "@/helpers/agent/config";
import { RA_MAX_COMPARE, RA_UPGRADE_URL } from "../config";
import {
  AGENT_CANDIDATE_COLUMNS,
  applicationUrl,
  type CandidateRow,
  compactCandidate,
  fairnessError,
  limitInput,
  type RecruiterToolContext,
  resumeExcerpt,
  textListInput,
  uuidInput,
  withToolErrors,
} from "./shared";

const JOB_NOT_FOUND = { error: "Job post not found." } as const;
const CONTACT_NOTE =
  "Contact details are shared when the candidate answers Interested to your outreach or applies to one of your jobs.";
const CANDIDATE_NOT_FOUND = { error: "Candidate not found." } as const;

// AGENT_CANDIDATE_COLUMNS plus the detail fields, as one literal so Supabase can type the row.
const PROFILE_DETAIL_COLUMNS =
  "user_id, full_name, desired_roles, preferred_locations, experience_years, top_skills, min_salary, max_salary, salary_currency, work_style_preferences, job_type, career_goals_short_term, career_goals_long_term, industry_preferences, visa_sponsorship_required, company_size_preference" as const;

/** Explanations are derived from candidate text, so they're sandboxed (RA-SEC-003). */
const sandboxedSummary = (explanation: MatchExplanation | null) =>
  explanation ? wrapInSandbox("match_explanation", explanation.summary) : null;

const sandboxedDetails = (explanation: MatchExplanation | null) =>
  explanation ? wrapInSandbox("match_explanation", JSON.stringify(explanation)) : null;

const completedExplanation = (row: { explanation: unknown; explanation_status: string | null }) =>
  row.explanation_status === "completed" ? parseStoredExplanation(row.explanation) : null;


export function createCandidateTools(ctx: RecruiterToolContext) {
  const { supabase, company } = ctx;

  /** Whether the company may see the candidate (public, or applied to its jobs). */
  const canView = async (candidateId: string) => {
    const { data, error } = await supabase.rpc("company_can_view_candidate", {
      p_user_id: candidateId,
    });
    if (error) throw error;
    return data === true;
  };

  const loadOwnJob = async (jobPostId: string, columns = "id, title") => {
    const { data, error } = await supabase
      .from("job_postings")
      .select(columns)
      .eq("id", jobPostId)
      .eq("company_id", company.id)
      .maybeSingle();
    if (error) throw error;
    return data as unknown as { id: string; title: string; matching_status?: string } | null;
  };

  return {
    searchCandidates: tool({
      description:
        "Search the GetHired talent pool (candidates who made their profile visible to companies), newest first. Every filter is optional; combine them to narrow the search. Only job-related criteria are accepted.",
      inputSchema: z.object({
        roles: textListInput("Desired roles, e.g. \"Backend Engineer\". Partial, case-insensitive match on any of them, so \"backend\" also finds \"Senior Backend Engineer\".", 5),
        skills: textListInput("Skills, e.g. \"Go\", \"Postgres\". Partial, case-insensitive match on any of them, so prefer specific terms (\"Java\" also matches \"JavaScript\").", 10),
        locations: textListInput("Cities or \"Remote\" the candidate wants to work in.", 5),
        minExperience: z.number().int().min(0).max(50).optional().describe("Minimum years of experience."),
        maxExperience: z.number().int().min(0).max(50).optional().describe("Maximum years of experience."),
        maxSalary: z
          .number()
          .min(0)
          .optional()
          .describe("The yearly budget: keeps candidates whose minimum expected salary is at most this. Salaries are in the candidate's currency, usually ₹ (e.g. 30 LPA = 3000000)."),
        jobTypes: z.array(z.enum(["Fulltime", "Contract", "Intern"])).max(3).optional(),
        workStyle: textListInput("Work styles, e.g. \"Remote\", \"Hybrid\", \"On-site\". Partial, case-insensitive match on any of them.", 3),
        cursor: z.string().max(200).optional().describe("The nextCursor from a previous search, for the next page."),
        limit: limitInput,
      }),
      execute: (input) =>
        withToolErrors(ctx, "searchCandidates", async () => {
          const unfair = fairnessError([
            ...(input.roles ?? []),
            ...(input.skills ?? []),
            ...(input.locations ?? []),
            ...(input.workStyle ?? []),
          ]);
          if (unfair) return unfair;

          const { profiles, nextCursor, planLimit } = await searchProfiles(company.id, {
            roles: input.roles,
            skills: input.skills,
            locations: input.locations,
            minExperience: input.minExperience,
            maxExperience: input.maxExperience,
            budget: input.maxSalary,
            jobTypes: input.jobTypes,
            workStyle: input.workStyle,
            limit: input.limit ?? AGENT_LIST_DEFAULT_LIMIT,
            cursor: input.cursor,
          });

          return {
            candidates: profiles.map((profile) => compactCandidate(profile as CandidateRow)),
            nextCursor,
            ...(planLimit !== null ? { planLimit, upgradeUrl: RA_UPGRADE_URL } : {}),
          };
        }),
    }),

    findMatchesForJob: tool({
      description:
        "List the candidates GetHired matched to one of the company's jobs, best first, with AI match scores (0–100). If matching hasn't run yet, returns a status instead; runMatchingForJob starts it.",
      inputSchema: z.object({ jobPostId: uuidInput("job post"), limit: limitInput }),
      execute: ({ jobPostId, limit }) =>
        withToolErrors(ctx, "findMatchesForJob", async () => {
          const job = await loadOwnJob(jobPostId, "id, title, matching_status");
          if (!job) return JOB_NOT_FOUND;
          if (job.matching_status !== "completed") {
            const status =
              job.matching_status === "progress"
                ? "processing"
                : job.matching_status === "failed"
                  ? "failed"
                  : "not_run";
            return { status, jobPostId };
          }

          const { data, error } = await supabase
            .from("job_relevant_profiles")
            .select("user_id, relevance_rank, match_score, explanation, explanation_status")
            .eq("job_posting_id", jobPostId)
            .order("relevance_rank", { ascending: true, nullsFirst: false })
            .limit(limit ?? AGENT_LIST_DEFAULT_LIMIT);
          if (error) throw error;

          // Directory rows, no contact details (OR-SEC-001). Candidates who went
          // private (or blocked the company) since matching are left out.
          const profiles = await loadVisibleCandidates<CandidateRow>(
            supabase,
            (data ?? []).flatMap((row) => (row.user_id ? [row.user_id] : [])),
            AGENT_CANDIDATE_COLUMNS,
          );

          return {
            job: { id: job.id, title: job.title },
            candidates: (data ?? [])
              .flatMap((row) => {
                const profile = row.user_id ? profiles.get(row.user_id) : undefined;
                return profile ? [{ row, profile }] : [];
              })
              .map(({ row, profile }) => ({
                ...compactCandidate(profile, { jobPostId }),
                rank: row.relevance_rank,
                matchScore: row.match_score,
                matchSummary: sandboxedSummary(completedExplanation(row)),
              })),
          };
        }),
    }),

    runMatchingForJob: tool({
      description:
        "Start matching talent-pool candidates to one of the company's jobs. It runs in the background for a few minutes; the company gets an email when it's done.",
      inputSchema: z.object({ jobPostId: uuidInput("job post") }),
      execute: ({ jobPostId }) =>
        withToolErrors(ctx, "runMatchingForJob", async () => {
          // The action checks the job belongs to the session's company.
          const result = await triggerJobPostingRelevanceUpdate(jobPostId);
          if (!result.success) return { error: result.error };
          return {
            status: "processing",
            jobPostId,
            note: "The company gets an email when matching finishes.",
          };
        }),
    }),

    getCandidateProfile: tool({
      description:
        "Read a candidate's profile: roles, experience, skills, preferences, a resume excerpt, their matches to the company's jobs, their applications to them, and whether they're saved. Contact details are included only once the candidate applied to one of the company's jobs or answered Interested to its outreach.",
      inputSchema: z.object({
        candidateId: uuidInput("candidate"),
        jobPostId: uuidInput("job post").optional().describe("A job to show the match for first."),
      }),
      execute: ({ candidateId, jobPostId }) =>
        withToolErrors(ctx, "getCandidateProfile", async () => {
          if (!(await canView(candidateId))) return CANDIDATE_NOT_FOUND;

          // RA-SEC-005: the full profile, with contact details and the resume,
          // only with access (applied, or answered Interested). Otherwise the
          // directory profile and its scrubbed resume sections.
          const { data: hasAccess, error: accessError } = await supabase.rpc("company_has_candidate_access", {
            p_user_id: candidateId,
          });
          if (accessError) throw accessError;

          let profile: (CandidateRow & Record<string, unknown>) | null;
          let resumeContent: TResumeRowContent | null;
          let contact: { email: string | null; linkedin: string | null; github: string | null } | null = null;
          if (hasAccess === true) {
            const [{ data: full, error }, { data: resume }] = await Promise.all([
              supabase
                .from("user_info")
                .select(`${PROFILE_DETAIL_COLUMNS}, email, linkedin_url, github_url`)
                .eq("user_id", candidateId)
                .maybeSingle(),
              supabase
                .from("resumes")
                .select("content")
                .eq("user_id", candidateId)
                .eq("is_primary", true)
                .limit(1)
                .maybeSingle(),
            ]);
            if (error) throw error;
            profile = full;
            resumeContent = (resume?.content as TResumeRowContent | null) ?? null;
            if (full) contact = { email: full.email, linkedin: full.linkedin_url, github: full.github_url };
          } else {
            const { data: listed, error } = await supabase
              .from("candidate_directory")
              .select(`${PROFILE_DETAIL_COLUMNS}, resume_sections`)
              .eq("user_id", candidateId)
              .maybeSingle();
            if (error) throw error;
            profile = listed as (CandidateRow & Record<string, unknown>) | null;
            resumeContent = Array.isArray(listed?.resume_sections)
              ? ({ sections: listed.resume_sections } as TResumeRowContent)
              : null;
          }
          if (!profile) return CANDIDATE_NOT_FOUND;

          // OR-REQ-020: the agent reading a profile is a view, like the page.
          after(async () => {
            const { error } = await supabase.rpc("record_profile_view", { p_candidate: candidateId });
            if (error) console.error("[agent] couldn't record the profile view", error.message);
          });

          const [matches, { data: applications, error: applicationsError }, { data: saved }] =
            await Promise.all([
              getCandidateMatches(supabase, candidateId, company.id, jobPostId),
              supabase
                .from("applications")
                .select("id, status, created_at, job_postings!inner(id, title, company_id)")
                .eq("applicant_user_id", candidateId)
                .eq("job_postings.company_id", company.id),
              supabase
                .from("company_favorites")
                .select("id")
                .eq("company_id", company.id)
                .eq("user_id", candidateId)
                .limit(1),
            ]);
          if (applicationsError) throw applicationsError;

          const goals = [profile.career_goals_short_term, profile.career_goals_long_term]
            .filter((goal): goal is string => typeof goal === "string" && !!goal.trim())
            .join("\n");

          return {
            ...compactCandidate(profile, { jobPostId }),
            industries: profile.industry_preferences ?? [],
            companySize: profile.company_size_preference,
            needsVisaSponsorship: profile.visa_sponsorship_required,
            careerGoals: goals ? wrapInSandbox("candidate_profile", scrubPII(goals)) : null,
            resumeExcerpt: resumeExcerpt(resumeContent),
            ...(contact ? { contact } : { contactNote: CONTACT_NOTE }),
            matches: matches.map((match) => ({
              jobPostId: match.jobPostId,
              jobTitle: match.jobTitle,
              matchScore: match.matchScore,
              explanation: sandboxedDetails(match.explanation),
            })),
            applications: (applications ?? []).map((application) => ({
              applicationId: application.id,
              jobTitle: application.job_postings.title,
              status: application.status,
              appliedAt: application.created_at,
              url: applicationUrl(application.id),
            })),
            saved: (saved ?? []).length > 0,
          };
        }),
    }),

    compareCandidates: tool({
      description: `Compare 2 to ${RA_MAX_COMPARE} candidates for one of the company's jobs: their profiles, match scores and reasons, and AI screening if they applied. Write the comparison yourself from the result.`,
      inputSchema: z.object({
        candidateIds: z.array(uuidInput("candidate")).min(2).max(RA_MAX_COMPARE),
        jobPostId: uuidInput("job post"),
      }),
      execute: ({ candidateIds, jobPostId }) =>
        withToolErrors(ctx, "compareCandidates", async () => {
          const job = await loadOwnJob(jobPostId);
          if (!job) return JOB_NOT_FOUND;
          const ids = [...new Set(candidateIds)];

          const [profiles, matches, applications] = await Promise.all([
            // Only candidates the company may see, without contact details.
            loadVisibleCandidates<CandidateRow>(supabase, ids, AGENT_CANDIDATE_COLUMNS),
            supabase
              .from("job_relevant_profiles")
              .select("user_id, match_score, explanation, explanation_status")
              .eq("job_posting_id", jobPostId)
              .in("user_id", ids),
            supabase
              .from("applications")
              .select("id, applicant_user_id, status, application_screenings(status, fit_score, recommendation)")
              .eq("job_post_id", jobPostId)
              .in("applicant_user_id", ids),
          ]);
          for (const { error } of [matches, applications]) if (error) throw error;

          return {
            job: { id: job.id, title: job.title },
            candidates: ids.map((id) => {
              const profile = profiles.get(id);
              if (!profile) return { id, ...CANDIDATE_NOT_FOUND };
              const match = (matches.data ?? []).find((m) => m.user_id === id);
              const application = (applications.data ?? []).find((a) => a.applicant_user_id === id);
              const screening = application?.application_screenings;
              const completed = screening?.status === "completed" ? screening : null;
              return {
                ...compactCandidate(profile, { jobPostId }),
                matchScore: match?.match_score ?? null,
                matchDetails: match ? sandboxedDetails(completedExplanation(match)) : null,
                application: application
                  ? {
                      id: application.id,
                      status: application.status,
                      fitScore: completed?.fit_score ?? null,
                      recommendation: completed?.recommendation ?? null,
                      url: applicationUrl(application.id),
                    }
                  : null,
              };
            }),
          };
        }),
    }),

    saveCandidate: tool({
      description: "Save a candidate to the company's shortlist (the Saved tab).",
      inputSchema: z.object({ candidateId: uuidInput("candidate") }),
      execute: ({ candidateId }) =>
        withToolErrors(ctx, "saveCandidate", async () => {
          if (!(await canView(candidateId))) return CANDIDATE_NOT_FOUND;

          const { data: existing, error } = await supabase
            .from("company_favorites")
            .select("id")
            .eq("company_id", company.id)
            .eq("user_id", candidateId)
            .limit(1);
          if (error) throw error;

          if ((existing ?? []).length === 0) {
            const { error: insertError } = await supabase
              .from("company_favorites")
              .insert({ company_id: company.id, user_id: candidateId });
            if (insertError) throw insertError;
          }
          return { candidateId, saved: true };
        }),
    }),

    unsaveCandidate: tool({
      description: "Remove a candidate from the company's shortlist.",
      inputSchema: z.object({ candidateId: uuidInput("candidate") }),
      execute: ({ candidateId }) =>
        withToolErrors(ctx, "unsaveCandidate", async () => {
          const { error } = await supabase
            .from("company_favorites")
            .delete()
            .eq("company_id", company.id)
            .eq("user_id", candidateId);
          if (error) throw error;
          return { candidateId, saved: false };
        }),
    }),
  };
}

