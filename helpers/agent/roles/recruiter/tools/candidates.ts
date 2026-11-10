import { reportError } from "@/helpers/posthog/report-error";
import { isExplanationReady } from "@/helpers/matching/explanation-status";
import { tool } from "ai";
import { after } from "next/server";
import { z } from "zod";
import { wrapInSandbox } from "@/helpers/ai/security";
import { scrubPII } from "@/helpers/ai/fairness";
import { searchProfiles } from "@/helpers/profiles/search-profiles";
import { loadVisibleCandidates } from "@/helpers/profiles/visible-candidates";
import { getCandidateMatches } from "@/helpers/matching/candidate-matches";
import { parseStoredExplanation, type MatchExplanation } from "@/helpers/matching/schemas";
import { queueJobPostingRelevance } from "@/helpers/profiles/queue-job-relevance";
import { outreachStatusFor, type OutreachBadge } from "@/helpers/outreach/list";
import type { TResumeRowContent } from "@/utils/types";
import { AGENT_LIST_DEFAULT_LIMIT } from "@/helpers/agent/config";
import { addCandidatesToJob } from "@/helpers/candidates/add-to-job";
import { describeAddToJob } from "@/helpers/candidates/copy";
import { candidateImportPath, candidatePath } from "@/helpers/candidates/paths";
import { listPoolMatches } from "@/helpers/candidates/pool-matches";
import { isMatchingInProgress } from "@/helpers/profiles/relevance-queue";
import { RA_MAX_COMPARE, RA_UPGRADE_URL } from "../config";
import {
  AGENT_CANDIDATE_COLUMNS,
  applicationUrl,
  type CandidateRow,
  compactCandidate,
  fairnessError,
  limitInput,
  outreachUrl,
  type RecruiterToolContext,
  requireToolPermission,
  resumeExcerpt,
  textListInput,
  uuidInput,
  withToolErrors,
} from "./shared";

const JOB_NOT_FOUND = { error: "Job post not found." } as const;
const CONTACT_NOTE =
  "Contact details are shared when the candidate answers Interested to your outreach or applies to one of your jobs.";
const CANDIDATE_NOT_FOUND = { error: "Candidate not found." } as const;
/** CP-REQ-063: skills per pool candidate in a tool output. */
const POOL_SKILLS_MAX = 15;
/** CP-REQ-063: company candidates added to a job in one call. */
const ADD_TO_JOB_MAX = 50;

/** A company candidate's own text, sandboxed (CP-SEC-003); null when empty. */
const sandboxedText = (tag: string, value: string | null | undefined) =>
  value?.trim() ? wrapInSandbox(tag, value.trim()) : null;

// AGENT_CANDIDATE_COLUMNS plus the detail fields, as one literal so Supabase can type the row.
const PROFILE_DETAIL_COLUMNS =
  "user_id, full_name, desired_roles, preferred_locations, experience_years, top_skills, min_salary, max_salary, salary_currency, work_style_preferences, job_type, career_goals_short_term, career_goals_long_term, industry_preferences, visa_sponsorship_required, company_size_preference" as const;

/** Explanations are derived from candidate text, so they're sandboxed (RA-SEC-003). */
const sandboxedSummary = (explanation: MatchExplanation | null) =>
  explanation ? wrapInSandbox("match_explanation", explanation.summary) : null;

const sandboxedDetails = (explanation: MatchExplanation | null) =>
  explanation ? wrapInSandbox("match_explanation", JSON.stringify(explanation)) : null;

const completedExplanation = (row: { explanation: unknown; explanation_status: string | null }) =>
  isExplanationReady(row.explanation_status) ? parseStoredExplanation(row.explanation) : null;


/**
 * An application's pipeline stage. `status` is only the applicant's coarse
 * projection of it (screening, interview and offer all read `reviewed`), so a
 * recruiter reader reports the stage as the real position (SM-REQ-009).
 */
const stageOf = (stage: { id: string; name: string; kind: string } | null) =>
  stage ? { id: stage.id, name: stage.name, kind: stage.kind } : null;

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
    return data as unknown as {
      id: string;
      title: string;
      matching_status?: string;
      matching_started_at?: string | null;
      updated_at?: string | null;
    } | null;
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
          const job = await loadOwnJob(jobPostId, "id, title, matching_status, matching_started_at, updated_at");
          if (!job) return JOB_NOT_FOUND;
          if (job.matching_status !== "completed") {
            // A `progress` past its timeout is a dead run (SM-REQ-005): it
            // reads as failed, so the model offers runMatchingForJob.
            const live = isMatchingInProgress({
              matching_status: job.matching_status ?? "pending",
              matching_started_at: job.matching_started_at ?? null,
              updated_at: job.updated_at ?? null,
            });
            const status = live
              ? "processing"
              : job.matching_status === "failed" || job.matching_status === "progress"
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
          // The helper checks the job belongs to the session's company.
          const result = await queueJobPostingRelevance(ctx, jobPostId);
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
        "Read a candidate's profile: roles, experience, skills, preferences, a resume excerpt, their matches to the company's jobs, their applications to them, the company's latest outreach to them, and whether they're saved. Contact details are included only once the candidate applied to one of the company's jobs or answered Interested to its outreach.",
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
            if (error) reportError("[agent] couldn't record the profile view", error.message);
          });

          const [matches, { data: applications, error: applicationsError }, { data: saved }, outreach] =
            await Promise.all([
              getCandidateMatches(supabase, candidateId, company.id, jobPostId),
              supabase
                .from("applications")
                .select("id, status, created_at, job_postings!inner(id, title, company_id), pipeline_stages(id, name, kind)")
                .eq("applicant_user_id", candidateId)
                .eq("job_postings.company_id", company.id),
              supabase
                .from("company_favorites")
                .select("id")
                .eq("company_id", company.id)
                .eq("user_id", candidateId)
                .limit(1),
              // The latest outreach, so the model doesn't propose a second open one.
              // Optional context: a failed read leaves it out.
              outreachStatusFor({ supabase, company }, [candidateId]).catch(
                () => ({}) as Record<string, OutreachBadge>,
              ),
            ]);
          if (applicationsError) throw applicationsError;
          const latestOutreach = outreach[candidateId];

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
              stage: stageOf(application.pipeline_stages),
              appliedAt: application.created_at,
              url: applicationUrl(application.id),
            })),
            saved: (saved ?? []).length > 0,
            outreach: latestOutreach
              ? {
                  id: latestOutreach.id,
                  status: latestOutreach.status,
                  sentAt: latestOutreach.sentAt.slice(0, 10),
                  url: outreachUrl(latestOutreach.id),
                }
              : null,
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
              .select(
                "id, applicant_user_id, status, pipeline_stages(id, name, kind), application_screenings(status, fit_score, recommendation)",
              )
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
                      stage: stageOf(application.pipeline_stages),
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

    findPoolCandidates: tool({
      description:
        "List the company's own candidates (people it imported or added, who aren't on GetHired) whose profile is closest to one of its jobs, best first, with a similarity from 0 to 100. Similarity compares the profile with the job's text: it isn't a fit score or a recommendation. Never includes contact details. addCandidatesToJob adds them to the job.",
      inputSchema: z.object({ jobPostId: uuidInput("job post"), limit: limitInput }),
      execute: ({ jobPostId, limit }) =>
        withToolErrors(ctx, "findPoolCandidates", async () => {
          // talent.view is checked before the call; the job needs jobs.view too (CP-REQ-063).
          const denied = requireToolPermission(ctx, "jobs.view", jobPostId);
          if (denied) return denied;

          const result = await listPoolMatches(supabase, jobPostId, { limit: limit ?? AGENT_LIST_DEFAULT_LIMIT });
          if (!result.ok) return { error: result.error };
          if (result.status === "no_job_embedding") {
            return {
              status: "job_not_ready",
              message: "The job was saved moments ago and is still being read. Try again in a minute.",
            };
          }
          if (result.status === "no_pool") {
            return {
              status: "no_candidates",
              message: "None of the company's candidates has a resume, title or skills to match on yet.",
              importUrl: candidateImportPath(),
            };
          }
          return {
            candidates: result.matches.map((m) => ({
              candidateId: m.id,
              name: wrapInSandbox("candidate_name", m.name.trim() || "Candidate"),
              title: sandboxedText("candidate_title", m.title),
              location: sandboxedText("candidate_location", m.location),
              experienceYears: m.experienceYears,
              skills: sandboxedText("candidate_skills", m.skills.slice(0, POOL_SKILLS_MAX).join(", ")),
              similarity: m.score,
              hasResume: m.hasResume,
              hasEmail: m.hasEmail,
              url: candidatePath(m.id),
            })),
          };
        }),
    }),

    addCandidatesToJob: tool({
      description:
        "Add up to 50 of the company's own candidates (ids from findPoolCandidates) to one of its jobs as applications, in the job's first stage unless stageId says otherwise. Nobody is emailed. Candidates with no email, or already in the job, are counted and skipped.",
      inputSchema: z.object({
        jobPostId: uuidInput("job post"),
        candidateIds: z.array(z.string().uuid()).min(1).max(ADD_TO_JOB_MAX),
        stageId: z.string().uuid().optional().describe("A pipeline stage id from listStages."),
      }),
      execute: ({ jobPostId, candidateIds, stageId }) =>
        withToolErrors(ctx, "addCandidatesToJob", async () => {
          const result = await addCandidatesToJob(supabase, { jobPostId, candidateIds, stageId });
          if (!result.ok) return { error: result.error };
          return {
            counts: result.counts,
            summary: describeAddToJob(result.counts),
            applicationsUrl: `/company/job-posts/${jobPostId}/applications`,
          };
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

