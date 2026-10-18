/** Similarity is job-related only: roles, skills and experience (RA-SEC-004). */
export const similarCandidatesPrompt = (candidateId: string) =>
  `Find candidates with similar roles, skills and experience to candidate ${candidateId}.`;

