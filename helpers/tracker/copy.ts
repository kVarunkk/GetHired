// Client-safe. The tracker's user-facing copy (AT-REQ-042: "My Jobs",
// "Applications", "Saved", "Discover"; never "Applied tab" or "Jobs page").

export const TRACKER_COPY = {
  appliedOnGetHired: "You applied through GetHired. It's already on your board.",
  limit: "You're tracking 2000 jobs, the most My Jobs holds. Remove some to add more.",
  notFound: "Application not found.",
  jobNotFound: "Job not found.",
  signIn: "Sign in first.",
  applicantsOnly: "Only applicants can track applications.",
  unexpected: "Something went wrong. Please try again.",
  backToSaved: "A job you applied to can't go back to Saved. Remove it instead.",
  urlUnreadable: "We couldn't read that page. Fill in the details below.",
  urlRateLimited: "You've read a lot of links this hour. Fill in the details below.",
  saved: "Saved",
  added: "Added to Applications",
  moved: "Moved to Applications",
  exists: "It's already in My Jobs.",
} as const;
