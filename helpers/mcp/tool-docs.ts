/**
 * What the applicant MCP catalog tells clients beyond the agent's own tool
 * definitions (MCP spec §4.5): input descriptions in MCP terms (snake_case
 * tool names, where each id comes from) and an outputSchema for each tool's
 * structuredContent. The agent's schemas stay as they are, since the
 * applicant baseline pins them; these apply over MCP only.
 *
 * Each output schema follows what the tool's body returns on success. Errors
 * come back as isError results with text, which the SDK doesn't check.
 */
import { z } from "zod";
import type { McpInputDescriptions } from "./schema";

// --- Input descriptions ---------------------------------------------------

const JOB_ID_SOURCES = "search_jobs, get_relevant_jobs, get_saved_jobs or another job list";
const LIMIT = "How many to return in this call. Defaults to 10.";

const jobFilters = (prefix: string): McpInputDescriptions => ({
  [`${prefix}keywords`]:
    "Words to look for in the job title. Add the common spellings of the same role, e.g. ['frontend', 'front-end', 'front end']. Put seniority (junior, senior, lead, fresher) in minExperience/maxExperience, not here.",
  [`${prefix}locations`]:
    "Where the user wants to work, e.g. ['Remote', 'Bengaluru']. Different spellings of a city, such as Bangalore and Bengaluru, find the same jobs.",
  [`${prefix}jobTypes`]: "Only these kinds of employment: full-time, contract or internship.",
  [`${prefix}minSalary`]:
    "The lowest salary the user would accept, as a plain whole number without a currency symbol or separators, e.g. 1500000.",
  [`${prefix}minExperience`]:
    "The bottom of the user's experience range, in years. A job matches when the experience it asks for overlaps the user's range. Seniority maps to this range: fresher or entry level is maxExperience 1, junior is maxExperience 2, mid level is minExperience 2 with maxExperience 5, senior is minExperience 5.",
  [`${prefix}maxExperience`]:
    "The top of the user's experience range, in years: only jobs asking for at most this much. Seniority maps to this range: fresher or entry level is maxExperience 1, junior is maxExperience 2, mid level is minExperience 2 with maxExperience 5, senior is minExperience 5.",
  [`${prefix}visaRequirements`]:
    "Only jobs whose posting states one of these visa terms. 'Will Sponsor' is for users who need the employer to sponsor a visa.",
  [`${prefix}platforms`]:
    "Only jobs found on these applicant tracking systems or job boards. gethired is jobs posted on GetHired itself, which can be applied to with submit_application.",
  [`${prefix}companies`]: "Only jobs at these companies, by company name, e.g. ['Stripe', 'Razorpay'].",
  [`${prefix}postedWithinDays`]: "Only jobs posted in the last this many days, e.g. 7 for the past week.",
});

const preferenceDescriptions = (replaces: string): McpInputDescriptions => ({
  desiredRoles: `Job titles the user is looking for, e.g. ['Frontend Engineer', 'UI Developer'].${replaces}`,
  preferredLocations: `Where the user wants to work, e.g. ['Remote', 'Bengaluru']. City names are saved in their standard spelling.${replaces}`,
  maxSalary: "The top of the user's yearly salary range, as a plain whole number in salaryCurrency.",
  salaryCurrency: "The currency of minSalary and maxSalary: ₹ rupees, $ US dollars, € euros, £ pounds, C$ Canadian dollars, A$ Australian dollars.",
  jobTypes: `The kinds of employment the user wants: full-time, contract or internship.${replaces}`,
  visaSponsorshipRequired: "true when the user needs an employer to sponsor their visa or work permit.",
  topSkills: `The user's main skills, e.g. ['React', 'TypeScript', 'Figma'].${replaces}`,
  workStylePreferences: `How the user likes to work, e.g. Remote, Hybrid, On-site, Startup Environment, Fast-paced.${replaces}`,
});

const RESUME_ITEM_FIELDS: McpInputDescriptions = {
  "operations.*.fields.heading": "The item's main line: a role, degree, project or skill group.",
  "operations.*.fields.subheading": "The item's second line: a company or school.",
  "operations.*.fields.startDate": "When it started, written as the user writes it, e.g. 'Jan 2022'.",
  "operations.*.fields.endDate": "When it ended, written as the user writes it, e.g. 'Present'.",
  "operations.*.fields.url": "A link for the item, such as a project's site or repository.",
};

export const MCP_INPUT_DESCRIPTIONS: Readonly<Record<string, McpInputDescriptions>> = {
  search_jobs: {
    ...jobFilters(""),
    cursor:
      "For the next page: the nextCursor from the previous search_jobs result, sent with the same filters. Leave out for the first page.",
    limit: LIMIT,
  },
  natural_language_job_search: {
    query:
      "What the user is looking for, in their own words, e.g. 'remote React jobs at fintech startups paying over 20 LPA'.",
    limit: LIMIT,
  },
  get_relevant_jobs: {
    filters: "Narrows the user's matches. Leave out to get their best matches overall.",
    ...jobFilters("filters."),
    limit: LIMIT,
  },
  get_similar_jobs: {
    jobId: `The job to find similar jobs to: an id from ${JOB_ID_SOURCES}.`,
    limit: LIMIT,
  },
  get_job_details: { jobId: `The job to read: an id from ${JOB_ID_SOURCES}.` },
  get_saved_jobs: { limit: LIMIT },
  get_applied_jobs: { limit: LIMIT },
  favorite_job: {
    jobId: `The job to save or unsave: an id from ${JOB_ID_SOURCES}.`,
    action: "save bookmarks the job for the user; unsave removes it from their saved jobs.",
  },
  list_applications: {
    status: "Only applications with this status, e.g. rejected to see the ones that were turned down. Leave out for all of them.",
    limit: LIMIT,
  },
  update_application_status: {
    jobId: `The external job the user applied to: an id from ${JOB_ID_SOURCES}, or a jobId from list_applications.`,
    status:
      "The status the user reports for their application, e.g. submitted once they applied on the company's site, or rejected after they heard back.",
  },
  get_application_form: {
    jobId: `The GetHired job (isPlatformJob true) to read the form of: an id from ${JOB_ID_SOURCES}.`,
  },
  submit_application: {
    jobId: "The GetHired job to apply to: the same jobId you read the form of with get_application_form.",
    resumeId: "Which of the user's resumes to send: an id from get_resumes. Leave out to send their primary resume.",
    answers: "The user's answers to the form, one entry per field. Leave out optional fields the user has nothing for.",
    "answers.*.key": "Which field this answers: its key from get_application_form's fields.",
    "answers.*.value":
      "The answer as text: yes or no for yes_no, digits for number, YYYY-MM-DD for date, an http(s) link for url, one of the field's options for single_select, and the amount and a 3-letter currency code for salary, e.g. 1500000 INR.",
    "answers.*.choices":
      "For multi_select fields, in place of value: the chosen options, each written as get_application_form lists it.",
  },
  update_my_preferences: {
    ...preferenceDescriptions(" Replaces the saved list."),
    minSalary: "The bottom of the user's yearly salary range, as a plain whole number in salaryCurrency.",
  },
  complete_onboarding: {
    ...preferenceDescriptions(""),
    fullName: "The user's full name, as it should appear on their profile.",
    minSalary: "The bottom of the user's yearly salary range, as a plain whole number in salaryCurrency.",
    experienceYears:
      "The user's total work experience in whole years, rounded to the nearest year: 6 months counts as 1, 2 months as 0.",
    companySizePreference: "The size of company the user prefers to work at. Any when they have no preference.",
    linkedinUrl: "The full link to the user's LinkedIn profile.",
    githubUrl: "The full link to the user's GitHub profile.",
    industryPreferences: "Industries the user wants to work in, e.g. ['Fintech', 'Healthcare'].",
    careerGoalsShortTerm: "What the user wants from their next role, in their own words.",
    careerGoalsLongTerm: "Where the user wants their career to go in the longer term, in their own words.",
    resumeId:
      "The resume to onboard with: an id from get_resumes. Leave out to use the primary resume. The user uploads resumes on GetHired's /resume page.",
  },
  get_resume_details: { resumeId: "The resume to read: an id from get_resumes." },
  set_primary_resume: { resumeId: "The resume to make primary: an id from get_resumes." },
  create_resume: {
    name: "A name for the user to tell their resumes apart by, e.g. 'Frontend Engineer 2026'.",
    sections: "The resume's sections, in order, with only what the user told you. Leave out for a blank resume.",
    "sections.*.type": "What the section holds. Use other, with a title, for a section that fits none of the rest.",
    "sections.*.items": "The section's entries, such as each role, degree or project.",
    "sections.*.items.*.location": "Where it was, e.g. 'Bengaluru, India' or 'Remote'.",
    "sections.*.items.*.url": "A link for the entry, such as a project's site or repository.",
    "sections.*.items.*.bullets": "The entry's bullet points, in order. An empty list when it has none.",
  },
  update_resume: {
    resumeId: "The resume to edit: an id from get_resumes.",
    expectedRevision:
      "The revision get_resume_details returned for this resume, or the one your last update_resume call returned. If the resume changed since, the call is refused: read it again and redo the change.",
    operations: "The edits, applied in order. Each one's op says what it does and which ids it needs.",
    "operations.*.op":
      "What this edit does: setBulletText, addBullet or removeBullet change bullets; setItemFields, addItem or removeItem change a section's entries; addSection, setSectionTitle or removeSection change sections; move reorders; setContact changes the contact details; rename renames the resume; setTemplate changes its layout.",
    "operations.*.bulletId": "The bullet's id, from get_resume_details.",
    "operations.*.itemId": "The entry's id (a role, degree, project and so on), from get_resume_details.",
    "operations.*.sectionId": "The section's id, from get_resume_details.",
    "operations.*.text": "The bullet's full text.",
    "operations.*.index":
      "The position within its parent, 0 for first. Past the end means last; when adding, leaving it out also means last.",
    "operations.*.fields": "The fields to set. Fields you leave out keep their value.",
    ...RESUME_ITEM_FIELDS,
    "operations.*.fields.location":
      "Where the entry was, or for setContact where the user lives, e.g. 'Bengaluru, India'.",
    "operations.*.bullets": "The new entry's bullet points, in order.",
    "operations.*.sectionType": "What the new section holds. Use other, with a title, for anything else.",
    "operations.*.title": "The section's heading as it should appear on the resume.",
    "operations.*.fields.fullName": "The user's name as it heads the resume.",
    "operations.*.fields.headline": "The line under the name, e.g. 'Senior Frontend Engineer'.",
    "operations.*.fields.email": "The email address shown on the resume.",
    "operations.*.fields.phone": "The phone number shown on the resume.",
    "operations.*.fields.links": "The links shown on the resume. Replaces the whole list.",
    "operations.*.fields.links.*.label": "The link's text, e.g. 'GitHub' or 'Portfolio'.",
    "operations.*.fields.links.*.url": "Where the link goes.",
    "operations.*.name": "The resume's new name.",
    "operations.*.template": "The layout the resume is shown and downloaded in.",
  },
  duplicate_resume: {
    resumeId: "The resume to copy: an id from get_resumes.",
    name: "A name for the copy. Leave out to let GetHired name it.",
  },
  delete_resume: { resumeId: "The resume to delete: an id from get_resumes." },
  apply_review_suggestions: {
    reviewId: "The review the changes come from: the reviewId from improve_resume, or an id from get_resume_reviews.",
    target:
      "Where the changes go: copy (when left out) puts them on a copy of the reviewed resume, which later calls for this review reuse; original changes the reviewed resume itself, only when the user asks for that.",
    items: "The changes the user chose.",
    "items.*.id": "The change's id, from improve_resume's changes or get_resume_review_details' suggestions.",
  },
  export_resume: {
    resumeId: "The resume to download: an id from get_resumes.",
    format: "The file type: pdf, or docx for Word. Leave out for pdf.",
  },
  get_resume_reviews: { limit: "How many reviews to return in this call. Defaults to 10." },
  get_resume_review_details: {
    reviewId: "The review to read: an id from get_resume_reviews, or the reviewId from improve_resume.",
  },
  pick_resume_for_job: {
    jobId: `The job to compare the resumes against: an id from ${JOB_ID_SOURCES}. Send this or jobDescription, not both.`,
    jobDescription: "The text of a job description the user pasted, for a job that isn't on GetHired. Send this or jobId, not both.",
    resumeIds:
      "Only when the user names which resumes to compare: their ids from get_resumes. Leave out to compare all of the user's ready resumes.",
    "resumeIds.*": "A resume id from get_resumes.",
  },
  improve_resume: {
    resumeId: "The resume to improve: an id from get_resumes.",
    jobId: `A job to tailor the resume to: an id from ${JOB_ID_SOURCES}. Leave out, with jobDescription, for a general review.`,
    jobDescription:
      "The text of a job description the user pasted, to tailor the resume to a job that isn't on GetHired. Don't send it with jobId.",
  },
  list_interviews: { limit: LIMIT },
  get_interview_analysis: {
    interviewId: "The mock interview: an id from list_interviews.",
    sessionId: "One of that interview's sessions, from list_interviews' sessions. Leave out for the latest session.",
  },
  create_interview: {
    jobId: `The job to practise for: an id from ${JOB_ID_SOURCES}.`,
    resumeId: "The resume the interviewer works from: an id from get_resumes. Leave out to use the primary resume.",
    name: "A name to find the interview by in the user's list, e.g. 'Stripe frontend practice'. Leave out for 'AI Interview'.",
  },
  list_screening_interviews: { limit: LIMIT },
};

// --- Output schemas -------------------------------------------------------

const text = z.string().nullable();
const count = z.number().int();
const link = z.string().describe("A full https link into GetHired.");

const job = z
  .object({
    id: z.string().describe("The job id, for get_job_details, favorite_job and the other job tools."),
    title: text,
    company: text,
    locations: z.array(z.string()),
    salary: text.describe("The salary range as the posting gives it."),
    jobType: text,
    experience: text.describe("The experience the posting asks for, as it gives it."),
    postedAt: text,
    url: link.describe("The job's page on GetHired."),
  })
  .passthrough();

const jobList = {
  jobs: z.array(job),
  totalCount: z.number().nullable().describe("How many jobs match in all, across pages."),
  nextCursor: text.describe("Pass to search_jobs as cursor for the next page; null on the last page."),
};

/** What a confirm tool returns before it runs, or when the user declines (§4.6). */
const confirmation = {
  needsConfirmation: z
    .boolean()
    .optional()
    .describe("true when nothing ran yet: show preview to the user, and call again with confirmation_token once they approve."),
  preview: z.string().optional().describe("What will happen, for the user to approve."),
  confirmation_token: z.string().optional().describe("Send back with the same input to run it after the user approves."),
  instruction: z.string().optional(),
  message: z.string().optional().describe("What happened, e.g. that the user declined and nothing was done."),
};

/** A confirm tool's result: the confirmation fields, or what the tool did, all optional. */
const confirmed = <T extends z.ZodRawShape>(shape: T) =>
  z.object(shape).partial().extend(confirmation).passthrough();

const output = <T extends z.ZodRawShape>(shape: T) => z.object(shape).passthrough();

const review = output({
  id: z.string(),
  name: text,
  status: z.enum(["draft", "processing", "completed", "failed"]),
  score: z.number().nullable().describe("The resume's score from the review, when it has one."),
  resume_id: text.describe("The reviewed resume."),
  job_id: text.describe("The job it was tailored to, if any."),
  created_at: text,
  updated_at: text,
});

const reviewChange = output({
  id: z.string().describe("Pass to apply_review_suggestions."),
  kind: z.enum(["rewrite", "add", "remove", "move"]),
  reason: z.string(),
  priority: z.string(),
  original: z.string().optional().describe("The bullet's current text, for rewrites and removals."),
  suggested: z.string().optional().describe("The new text, for rewrites and additions."),
  placeholders: z
    .array(z.string())
    .optional()
    .describe("[placeholders] in suggested that the user must fill in before it can be applied."),
});

const resumeFit = output({
  id: z.string(),
  name: text,
  score: z
    .number()
    .optional()
    .describe("The share of the job's requirements the resume shows, 0-100, must-haves counting double."),
  matched: z.array(output({ requirement: z.string(), quote: z.string() })).optional(),
  missing: z.array(output({ text: z.string(), importance: z.enum(["must", "nice"]) })).optional(),
});

export const MCP_OUTPUT_SCHEMAS: Readonly<Record<string, z.ZodTypeAny>> = {
  search_jobs: output(jobList),
  natural_language_job_search: output({
    ...jobList,
    filters: z.record(z.unknown()).describe("The filters the AI read from the query."),
  }),
  get_relevant_jobs: output(jobList),
  get_similar_jobs: output(jobList),
  get_job_details: job.extend({
    description: z.string().describe("The posting's text, delimited as data."),
    visaRequirement: text,
    platform: text.describe("Where the job was found; gethired for jobs posted on GetHired."),
    summary: text.describe("A short AI summary of the posting, delimited as data."),
    isPlatformJob: z.boolean().nullable().describe("true for jobs on GetHired, which submit_application can apply to."),
    applyUrl: link.describe("Where the user applies."),
  }),
  get_saved_jobs: output(jobList),
  get_applied_jobs: output(jobList),
  favorite_job: output({ jobId: z.string(), saved: z.boolean().describe("Whether the job is saved now.") }),
  list_applications: output({
    applications: z.array(
      output({
        id: z.string(),
        jobId: text,
        title: text,
        company: text,
        locations: z.array(z.string()),
        status: text,
        appliedAt: text,
        updatedAt: text,
        isPlatformJob: z.boolean().describe("true when the user applied through GetHired."),
        url: link.nullable(),
      }),
    ),
  }),
  update_application_status: output({
    jobId: z.string(),
    title: text,
    company: text,
    status: z.string(),
    created: z.boolean().describe("true when this made a new application record."),
  }),
  get_application_form: output({
    jobId: z.string(),
    title: text,
    company: text,
    canApply: z.boolean(),
    notReadyReason: text.describe("Why the user can't apply yet, when canApply is false."),
    resume: output({ id: z.string(), name: text }).nullable().describe("The resume that would be sent."),
    fields: z
      .string()
      .describe("The form's fields as JSON, delimited as data: each one's key, label, type, whether it's required, and its options or limits."),
    suggestedAnswers: z
      .array(output({ key: z.string(), value: z.string().optional(), choices: z.array(z.string()).optional() }))
      .describe("Answers taken from the user's profile, in submit_application's answers format."),
  }),
  submit_application: confirmed({
    applied: z.boolean(),
    jobId: z.string(),
    title: text,
    company: text,
    resume: text.describe("The name of the resume that was sent."),
    url: link,
  }),
  get_my_profile: output({
    user_id: z.string(),
    email: z.string().optional(),
    full_name: text,
    ai_credits: z.number().nullable().describe("The user's AI credit balance."),
    onboarding_complete: z.boolean().nullable(),
    invitations_count: z.number().nullable(),
    metrics: z.record(z.unknown()).describe("The user's activity this week."),
    recent_applications: z
      .array(z.record(z.unknown()))
      .describe("The three newest applications: the job's id, title, company, platform and locations, with status and applied_at."),
  }),
  update_my_preferences: confirmed({
    updated: z.array(z.string()).describe("The preferences that were changed."),
    preferredLocations: z.array(z.string()).describe("The locations as saved, when they were changed."),
    matches: z.string().describe("What happens to the user's job matches now."),
  }),
  complete_onboarding: confirmed({
    onboarded: z.boolean(),
    resume: output({ id: z.string(), name: text }),
    preferredLocations: z.array(z.string()),
  }),
  get_resumes: output({
    resumes: z.array(
      output({
        id: z.string(),
        name: text,
        isPrimary: z.boolean().nullable(),
        status: z.enum(["ready", "processing", "failed"]),
        createdAt: text,
      }),
    ),
  }),
  get_resume_details: output({
    resume: output({
      id: z.string(),
      name: text,
      content: z.unknown().describe("The sections, each with its items and bullets, every one with its id."),
      contact: z.unknown().describe("The contact details: name, headline, email, phone, location and links."),
      template: text,
      revision: z.number().nullable().describe("Pass to update_resume as expectedRevision."),
      is_primary: z.boolean().nullable(),
      created_at: text,
      updated_at: text,
    }),
  }),
  set_primary_resume: output({
    resumeId: z.string(),
    isPrimary: z.boolean(),
    matches: z.string().describe("What happens to the user's job matches now."),
  }),
  create_resume: confirmed({
    resumeId: z.string(),
    url: link.describe("Where the user edits the new resume."),
  }),
  update_resume: confirmed({
    resumeId: z.string(),
    revision: z.number().describe("The new revision, for the next update_resume call."),
    url: link,
  }),
  duplicate_resume: output({ resumeId: z.string().describe("The copy's id."), url: link, message: z.string() }),
  delete_resume: confirmed({
    resumeId: z.string(),
    deleted: z.boolean(),
    reviewsDeleted: count.describe("How many of its reviews were deleted with it."),
  }),
  apply_review_suggestions: confirmed({
    target: z.enum(["copy", "original"]),
    resumeId: text.describe("The resume the changes went to."),
    items: z
      .array(output({ id: z.string(), status: z.enum(["applied", "already_applied", "changed", "not_found"]) }))
      .describe("Each change's result. changed means the resume moved on since the review, so it wasn't applied."),
    url: link,
  }),
  export_resume: output({
    resumeId: z.string(),
    name: text,
    format: z.enum(["pdf", "docx"]),
    url: link.describe("Downloads the file in a browser where the user is signed in to GetHired."),
  }),
  get_resume_reviews: output({ reviews: z.array(review) }),
  get_resume_review_details: output({
    id: z.string(),
    name: text,
    status: z.enum(["draft", "processing", "completed", "failed"]),
    score: z.number().nullable(),
    overallFeedback: text,
    totalSuggestions: count,
    pendingOnCopy: count,
    pendingOnOriginal: count,
    copyResumeId: text.describe("The copy the changes go to by default, once one exists."),
    createdAt: text,
    suggestions: z.array(
      reviewChange.extend({
        section: z.string().optional(),
        onCopy: z.string().describe("pending, applied, changed, or unknown when that resume is gone."),
        onOriginal: z.string().describe("pending, applied, changed, or unknown when that resume is gone."),
      }),
    ),
  }),
  pick_resume_for_job: output({
    job: job.nullable().optional().describe("The job compared against, or null for a pasted description."),
    requirementCount: count.optional(),
    best: resumeFit.describe("The best fit, with the requirements it matches and misses."),
    others: z.array(resumeFit).describe("The other resumes compared, best first, with what each misses."),
    shortlisted: z.string().optional(),
    note: z.string().optional(),
    message: z.string(),
  }),
  improve_resume: output({
    reviewId: z.string().describe("Pass to apply_review_suggestions."),
    tailoredFor: z.string().describe("What the review was tailored to, delimited as data."),
    summary: z.string().describe("The review's summary, delimited as data."),
    counts: output({ rewrites: count, additions: count, removals: count, moves: count, gaps: count }),
    gaps: z.string().describe("Questions for the user about what the resume is missing, as JSON, delimited as data."),
    changes: z
      .string()
      .describe("The suggested changes as JSON, delimited as data: each one's id, kind, reason, priority and text."),
    message: z.string(),
  }),
  list_interviews: output({
    interviews: z.array(
      output({
        id: z.string(),
        name: z.string(),
        createdAt: text,
        job: output({ id: z.string(), title: text, company: text }).nullable(),
        resume: output({ id: z.string(), name: text }).nullable(),
        sessions: z.array(
          output({
            id: z.string().describe("Pass to get_interview_analysis as sessionId."),
            startedAt: text,
            status: text,
            analysis: text.describe("The analysis status: completed, processing, failed, or null when none."),
          }),
        ),
        url: link,
      }),
    ),
  }),
  get_interview_analysis: output({
    interviewId: z.string(),
    name: z.string(),
    sessionId: z.string().optional(),
    status: z
      .string()
      .describe("completed when the feedback below is there; otherwise not_started, pending, processing or failed, with a message."),
    message: z.string().optional(),
    url: link,
    overallFeedback: z.string().optional(),
    communication: output({ score: z.number(), feedback: z.string() }).optional().describe("Scored 1-5."),
    roleFit: output({ score: z.number(), feedback: z.string() }).optional().describe("Scored 1-5."),
    strengths: z.array(output({ title: z.string(), evidence: z.string() })).optional(),
    improvementAreas: z.array(output({ title: z.string(), suggestion: z.string() })).optional(),
    practiceTips: z.array(z.string()).optional(),
  }),
  create_interview: output({
    interviewId: z.string(),
    url: link.describe("Where the user starts the interview."),
    message: z.string(),
  }),
  list_screening_interviews: output({
    interviews: z.array(
      output({
        id: z.string(),
        applicationId: text,
        job: output({ id: text, title: text, company: text }),
        status: z.string(),
        invitedAt: text,
        deadlineAt: text,
        completedAt: text,
        durationMinutes: z.number().nullable(),
        attemptsLeft: z.number(),
        url: link.describe("Where the user takes the interview."),
      }),
    ),
  }),
};
