// The bucket the old resume files live in. Version 2 resumes store no file
// (RE-REQ-011), so this exists for the migration and for the readers of a
// version 1 resume until the cleanup release (RE-REQ-099, RE-REQ-100).

export const RESUME_FILE_BUCKET = "resumes";

/** A file under the bucket, as the migration records it: `resumes/<user_id>/<name>`. */
export const resumeFilePath = (path: string) => `resumes/${path}`;
