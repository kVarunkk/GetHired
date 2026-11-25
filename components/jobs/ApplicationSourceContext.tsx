"use client";

import { jobApplyPath } from "@/helpers/jobs/apply-path";
import { createContext, useContext, type ReactNode } from "react";

/** CP-REQ-013: where an application starts. The default is the job board. */
export type ApplicationSource = {
  source?: "applied" | "careers_page" | "job_board";
  ref?: string | null;
  /** Where login (or sign-up) returns to, e.g. the careers job page with its ?ref=… */
  returnTo?: string;
  /** AP-REQ-022: the apply page for this context (the careers one, or /jobs/<id>/apply with its source tag). */
  applyHref?: string;
};

const ApplicationSourceContext = createContext<ApplicationSource>({});

/** Wraps a careers job page so its Apply records `careers_page` and the `?ref=`. */
export function ApplicationSourceProvider({ value, children }: { value: ApplicationSource; children: ReactNode }) {
  return <ApplicationSourceContext.Provider value={value}>{children}</ApplicationSourceContext.Provider>;
}

export const useApplicationSource = () => useContext(ApplicationSourceContext);

/** The login link for a signed-out applicant: back to this page (careers) or /jobs/<id>. Login links to sign-up, keeping the return path. */
export function useLoginToApplyHref(allJobsId: string): string {
  const { returnTo } = useApplicationSource();
  return `/auth/login?returnTo=${encodeURIComponent(returnTo ?? `/jobs/${allJobsId}`)}`;
}

/** AP-REQ-022: where Apply goes for a job: the context's apply page, else /jobs/<id>/apply. */
export function useApplyHref(allJobsId: string): string {
  const { applyHref } = useApplicationSource();
  return applyHref ?? jobApplyPath(allJobsId);
}
