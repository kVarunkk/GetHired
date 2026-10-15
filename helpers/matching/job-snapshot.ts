import { createHash } from "node:crypto";

/** The job columns a screening or explanation depends on (MT-REQ-008). */
export const JOB_SNAPSHOT_COLUMNS = "title, description, skills, min_experience, max_experience";

type JobSnapshotSource = {
  title: string | null;
  description: string | null;
  skills: string[] | null;
  min_experience: number | null;
  max_experience: number | null;
};

const squash = (text: string | null | undefined) => (text ?? "").replace(/\s+/g, " ").trim();

/**
 * A hash of the parts of a job post that screening and explanations read:
 * title, description, skills and the experience range. Whitespace, skill
 * order and every other column (salary, status, location, timestamps) don't
 * change it, so only a real edit marks results stale. The `experience` label
 * is derived from the range (`buildExperience`), so it's left out.
 */
export function jobSnapshotHash(job: JobSnapshotSource): string {
  const snapshot = [
    squash(job.title),
    squash(job.description),
    (job.skills ?? []).map((skill) => squash(skill).toLowerCase()).filter(Boolean).sort(),
    job.min_experience ?? null,
    job.max_experience ?? null,
  ];
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}
