// Resume limits and tunables (plan/resume-editor/feature-resume-editor-spec.md).
// Client-safe, so the editor shows the same limits the server enforces.

export const RESUME_LIMITS = {
  sections: 20,
  itemsPerSection: 40,
  bulletsPerItem: 30,
  bulletChars: 2_000,
  shortFieldChars: 300,
  contactLinks: 10,
} as const;

/** The size caps the check constraints enforce (RE-REQ-006), as JSON text. */
export const RESUME_MAX_CONTENT_BYTES = 1_000_000;
export const RESUME_MAX_CONTACT_BYTES = 20_000;

export const RESUME_SECTION_TYPES = [
  "summary",
  "experience",
  "projects",
  "skills",
  "education",
  "achievements",
  "certifications",
  "languages",
  "publications",
  "volunteering",
  "awards",
  "other",
] as const;
export type ResumeSectionType = (typeof RESUME_SECTION_TYPES)[number];

export const RESUME_SECTION_LABELS: Record<ResumeSectionType, string> = {
  summary: "Summary",
  experience: "Experience",
  projects: "Projects",
  skills: "Skills",
  education: "Education",
  achievements: "Achievements",
  certifications: "Certifications",
  languages: "Languages",
  publications: "Publications",
  volunteering: "Volunteering",
  awards: "Awards",
  other: "Other",
};

export const RESUME_TEMPLATES = ["classic", "compact"] as const;
export type ResumeTemplate = (typeof RESUME_TEMPLATES)[number];
export const RESUME_DEFAULT_TEMPLATE: ResumeTemplate = "classic";

/** RE-REQ-036: applies to creating, copying and uploading. */
export const RESUME_MAX_PER_USER = 20;

/** RE-REQ-012: the upload limit, checked in the browser and on the server. */
export const RESUME_MAX_FILE_BYTES = 2 * 1024 * 1024;
export const RESUME_FILE_ACCEPT =
  ".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export const RESUME_PARSE_MODEL = "gemini-3.1-flash-lite";
/** RE-REQ-013: aborts the model call. */
export const RESUME_PARSE_TIMEOUT_MS = 45_000;
/** RE-REQ-016: more unused source lines than this shows the notice. */
export const RESUME_UNUSED_LINE_WARNING = 3;
/** The resume text sent to the model, at most. */
export const RESUME_MAX_TEXT_CHARS = 30_000;

/** RE-REQ-094: how close a re-parsed bullet must be to keep an old bullet's id. */
export const RESUME_BULLET_MATCH_THRESHOLD = 0.6;

/** RE-REQ-096: a re-parsed file below this share of used lines is `low_coverage`. */
export const RESUME_MIGRATION_MIN_COVERAGE = 0.8;

/** RE-REQ-035: what a blank resume starts with. */
export const RESUME_BLANK_SECTIONS: readonly ResumeSectionType[] = ["summary", "experience", "education", "skills"];

export const RESUME_FILE_TYPE_ERROR = "Upload a PDF or Word (.docx) file.";
export const RESUME_FILE_SIZE_ERROR = "The file must be 2 MB or smaller.";

/** The browser's check before sending a file (RE-REQ-012); the server sniffs the bytes. */
export function resumeFileProblem(file: { name: string; size: number }): string | null {
  if (!/\.(pdf|docx)$/i.test(file.name)) return RESUME_FILE_TYPE_ERROR;
  if (file.size > RESUME_MAX_FILE_BYTES) return RESUME_FILE_SIZE_ERROR;
  return null;
}
