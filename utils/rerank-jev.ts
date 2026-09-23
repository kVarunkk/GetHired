import { experimental_evaluate as evaluate } from "ai";
import {
  AllJobWithRelations,
  CandidateState,
  GenericRerankOptions,
  RerankMode,
  ScoreReturnType,
  RerankResult,
  JobPostingsRow,
} from "./types";
import { typeSafeAi } from "@ai-sdk/typesafe-ai";

type EvaluationResultAnswers<T extends RerankMode> =
  T extends "relevant_profiles"
    ? {
        [
          K in keyof ReturnType<typeof getProfileEvaluationQuestions>
        ]: ScoreReturnType;
      }
    : T extends "similar_jobs"
      ? {
          [
            K in keyof ReturnType<typeof getSimilarJobsEvaluationQuestions>
          ]: ScoreReturnType;
        }
      : {
          [
            K in keyof ReturnType<typeof getJobEvaluationQuestions>
          ]: ScoreReturnType;
        };

export async function rerankWithJev<
  TItem extends AllJobWithRelations | CandidateState | JobPostingsRow,
>(options: GenericRerankOptions<TItem>): Promise<RerankResult> {
  const { type, reference, items } = options;
  const isProfileRerank = type === "relevant_profiles";
  const isSimilarJobs = type === "similar_jobs";

  // 1. Evaluate all items concurrently
  const evaluatedItems = await Promise.all(
    items.map(async (item) => {
      try {
        let evaluationState;
        let evaluationQuestions;

        if (isProfileRerank) {
          evaluationState = buildProfileEvaluationState(
            reference as JobPostingsRow,
            item as CandidateState,
          );
          console.log(
            "evaluation state: ",
            JSON.stringify(evaluationState, null, 2),
          );
          evaluationQuestions = getProfileEvaluationQuestions();
        } else if (isSimilarJobs) {
          evaluationState = buildSimilarJobsEvaluationState(
            reference as AllJobWithRelations,
            item as AllJobWithRelations,
          );
          evaluationQuestions = getSimilarJobsEvaluationQuestions();
        } else {
          // Standard job evaluation (job_digest, job_digest_with_suggestions)
          evaluationState = buildJobEvaluationState(
            reference as CandidateState,
            item as AllJobWithRelations,
          );
          evaluationQuestions = getJobEvaluationQuestions();
        }

        const result = await evaluate({
          model: typeSafeAi.evaluationModel("jev-latest"),
          state: evaluationState,
          questions: evaluationQuestions,
          providerOptions: {
            gateway: { zeroDataRetention: true },
          },
        });

        return {
          itemId: isProfileRerank
            ? (item as CandidateState).id
            : (item as AllJobWithRelations).id,
          scores: result.answers,
          success: true as const,
        };
      } catch (error) {
        return {
          itemId: isProfileRerank
            ? (item as CandidateState).id
            : (item as AllJobWithRelations).id,
          success: false as const,
          error,
        };
      }
    }),
  );

  const filtered_out_ids: string[] = [];
  const validEvaluations: Array<{
    id: string;
    aggregateScore: number;
  }> = [];

  // 2. Process scores programmatically
  for (const evaluated of evaluatedItems) {
    if (!evaluated.success) {
      filtered_out_ids.push(evaluated.itemId);
      continue;
    }

    const scores = evaluated.scores as EvaluationResultAnswers<typeof type>;

    if (isProfileRerank) {
      const { skillsMatch, experienceMatch, preferenceMismatch } =
        scores as EvaluationResultAnswers<"relevant_profiles">;

      if ((preferenceMismatch?.probability ?? 0) >= 0.8) {
        filtered_out_ids.push(evaluated.itemId);
        continue;
      }

      if (skillsMatch.score < 1.8) {
        filtered_out_ids.push(evaluated.itemId);
        continue;
      }

      const aggregateScore =
        skillsMatch.score * 0.6 + experienceMatch.score * 0.4;
      validEvaluations.push({
        id: evaluated.itemId,
        aggregateScore,
      });
    } else if (isSimilarJobs) {
      const {
        techStackOverlap,
        roleSimilarity,
        scopeAlignment,
        locationMatch,
      } = scores as EvaluationResultAnswers<"similar_jobs">;

      if (techStackOverlap.score < 1.8) {
        filtered_out_ids.push(evaluated.itemId);
        continue;
      }

      const aggregateScore =
        techStackOverlap.score * 0.4 +
        roleSimilarity.score * 0.3 +
        scopeAlignment.score * 0.2 +
        locationMatch.score * 0.1;

      validEvaluations.push({
        id: evaluated.itemId,
        aggregateScore,
      });
    } else {
      // job_digest / job_digest_with_suggestions
      const {
        skillsMatch,
        experienceMatch,
        roleAlignment,
        preferenceMismatch,
        locationMatch,
      } = scores as EvaluationResultAnswers<"job_digest">;

      if ((preferenceMismatch?.probability ?? 0) >= 0.8) {
        filtered_out_ids.push(evaluated.itemId);
        continue;
      }

      if (skillsMatch.score < 1.8) {
        filtered_out_ids.push(evaluated.itemId);
        continue;
      }

      const aggregateScore =
        skillsMatch.score * 0.5 +
        experienceMatch.score * 0.3 +
        roleAlignment.score * 0.2 +
        locationMatch.score * 0.1;

      validEvaluations.push({
        id: evaluated.itemId,
        aggregateScore,
      });
    }
  }

  // 3. Sort descending by score
  validEvaluations.sort((a, b) => b.aggregateScore - a.aggregateScore);

  return {
    reranked_job_ids: validEvaluations.map((item) => item.id),
    filtered_out_ids,
  };
}

// --- Helper Builders & Questions ---

function buildJobEvaluationState(
  candidate: CandidateState,
  job: AllJobWithRelations,
) {
  return {
    reference: {
      desiredRoles: candidate.preferences.desired_roles,
      skills:
        candidate.skillsText +
        (candidate.preferences.top_skills?.join(", ") ?? ""),
      experienceText: candidate.experienceText,
      yearsOfExperience: candidate.preferences.experience_years,
      preferredLocations: candidate.preferences.preferred_locations,
      salaryRange: `${candidate.preferences.min_salary} - ${candidate.preferences.max_salary}`,
      visaRequired: candidate.preferences.visa_sponsorship_required
        ? "Yes"
        : "No",
      projects: candidate.projectsText,
      workStyle: candidate.preferences.work_style_preferences,
      jobType: candidate.preferences.job_type,
      companySizePref: candidate.preferences.company_size_preference,
      careerGoals: `${candidate.preferences.career_goals_short_term} | ${candidate.preferences.career_goals_long_term}`,
    },
    target: {
      id: job.id,
      title: job.job_name,
      description: job.description?.slice(0, 2000),
      experienceRequired: job.experience,
      visaRequirement: job.visa_requirement,
      salaryRange: job.salary_range,
      locations: job.locations,
    },
  };
}

function buildProfileEvaluationState(
  job: JobPostingsRow,
  candidate: CandidateState,
) {
  return {
    reference: {
      id: job.id,
      title: job.title,
      description: job.description?.slice(0, 2000),
      experienceRequired: job.experience,
      // visaRequirement: job.visa_requirement,
      salaryRange: job.salary_range,
      locations: job.location,
    },
    target: {
      desiredRoles: candidate.preferences.desired_roles,
      skills:
        candidate.skillsText +
        (candidate.preferences.top_skills?.join(", ") ?? ""),
      experienceText: candidate.experienceText,
      yearsOfExperience: candidate.preferences.experience_years,
      preferredLocations: candidate.preferences.preferred_locations,
      salaryRange: `${candidate.preferences.min_salary} - ${candidate.preferences.max_salary}`,
      visaRequired: candidate.preferences.visa_sponsorship_required
        ? "Yes"
        : "No",
      projects: candidate.projectsText,
      workStyle: candidate.preferences.work_style_preferences,
      jobType: candidate.preferences.job_type,
      companySizePref: candidate.preferences.company_size_preference,
      careerGoals: `${candidate.preferences.career_goals_short_term} | ${candidate.preferences.career_goals_long_term}`,
    },
  };
}

function buildSimilarJobsEvaluationState(
  referenceJob: AllJobWithRelations,
  candidateJob: AllJobWithRelations,
) {
  return {
    reference: {
      id: referenceJob.id,
      title: referenceJob.job_name,
      description: referenceJob.description?.slice(0, 2000),
      experienceRequired: referenceJob.experience,
      salaryRange: referenceJob.salary_range,
      locations: referenceJob.locations,
    },
    target: {
      id: candidateJob.id,
      title: candidateJob.job_name,
      description: candidateJob.description?.slice(0, 2000),
      experienceRequired: candidateJob.experience,
      salaryRange: candidateJob.salary_range,
      locations: referenceJob.locations,
    },
  };
}

function getJobEvaluationQuestions() {
  return {
    skillsMatch: {
      type: "score" as const,
      instructions:
        "How closely do the candidate’s skills align with the job requirements?",
      criteria: [
        "No match or completely mismatched stack",
        "Minor skills match, requires extensive training",
        "Moderate alignment, partial core stack overlap",
        "Strong skills alignment, matches most core requirements",
        "Exceptional stack overlap, exact tool/language matches",
      ],
    },
    experienceMatch: {
      type: "score" as const,
      instructions:
        "Does the candidate’s seniority or experience level match what this job asks for?",
      criteria: [
        "Completely overqualified or underqualified",
        "Misaligned seniority level",
        "Acceptable baseline experience match",
        "Strong experience fit",
        "Perfect matching role/seniority profile",
      ],
    },
    roleAlignment: {
      type: "score" as const,
      instructions:
        "Based on the candidate’s projects and short/long-term career goals, how well does this role align with their trajectory?",
      criteria: [
        "Completely off-track for their goals",
        "Slight relevance to projects/goals",
        "Good stepping stone alignment",
        "Strong alignment with projects and future growth goals",
      ],
    },
    preferenceMismatch: {
      type: "boolean" as const,
      instructions:
        "Is there a hard mismatch between candidate preferences (Job Type, Work Style, Company Size) and the job properties?",
    },
    locationMatch: {
      type: "score" as const,
      instructions:
        "How well do the candidate's preferred locations and work style align with the job's location and remote requirements?",
      criteria: [
        "Completely incompatible locations/onsite requirements",
        "Different regions but potential remote flexibility overlap",
        "Exact match on location or fully remote compatibility",
      ],
    },
  };
}

function getProfileEvaluationQuestions() {
  return {
    skillsMatch: {
      type: "score" as const,
      instructions:
        "How well does this candidate's skill set cover the core requirements needed for this job post?",
      criteria: [
        "Lacks foundational skills required for the job",
        "Partial skills overlap with significant gaps",
        "Good core skills coverage",
        "Strong alignment with nearly all requirements",
        "Exact tech stack and tool match",
      ],
    },
    experienceMatch: {
      type: "score" as const,
      instructions:
        "How well does the candidate's experience level match the seniority demanded by the job post?",
      criteria: [
        "Significantly under or over-qualified",
        "Seniority gap present",
        "Acceptable experience match",
        "Strong match for the target level",
        "Ideal seniority and track record",
      ],
    },
    preferenceMismatch: {
      type: "boolean" as const,
      instructions:
        "Is there a major conflict between the candidate's location, visa, or work-style preferences and the job constraints?",
    },
  };
}

function getSimilarJobsEvaluationQuestions() {
  return {
    techStackOverlap: {
      type: "score" as const,
      instructions:
        "How similar are the core technologies, tools, and tech stack required between the reference job and candidate job?",
      criteria: [
        "Completely different domains and technology stacks",
        "Minor conceptual overlap",
        "Moderate tech stack overlap",
        "Very similar technologies and tools",
        "Nearly identical tech stack and tooling",
      ],
    },
    roleSimilarity: {
      type: "score" as const,
      instructions:
        "How closely does the job title and core responsibilities match between the reference job and candidate job?",
      criteria: [
        "Completely different job functions",
        "Adjacent role but different focus",
        "Similar functional domain",
        "Very close role match",
        "Virtually the same job title and core duties",
      ],
    },
    scopeAlignment: {
      type: "score" as const,
      instructions:
        "How well do the seniority level and experience requirements align between both jobs?",
      criteria: [
        "Mismatched seniority levels (e.g., Junior vs. Principal)",
        "Slight seniority discrepancy",
        "Comparable seniority tier",
      ],
    },
    locationMatch: {
      type: "score" as const,
      instructions:
        "How well do the geographic locations or remote flexibility match between the reference job and candidate job?",
      criteria: [
        "Completely different locations with no remote overlap",
        "Different regions but both offer remote options",
        "Same city, region, or identical location setup",
      ],
    },
  };
}
