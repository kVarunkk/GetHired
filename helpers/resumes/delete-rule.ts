/**
 * Why a resume can't be deleted, or null when it can (RE-REQ-037). Client-safe:
 * the list and the resume page show it on the disabled Delete, and
 * `deleteResume` refuses the same case on the server. Only the primary is kept,
 * because the profile and matches are built from it; any other resume can go,
 * even the user's only one.
 */
export function resumeDeleteBlockedReason({ isPrimary }: { isPrimary: boolean }): string | null {
  if (isPrimary) return "It's your primary resume. Make another one primary first.";
  return null;
}
