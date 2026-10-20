"use client";

import { createContext, useContext, type ReactNode } from "react";

/** CP-REQ-013: where an application starts. The default is the job board. */
export type ApplicationSource = {
  source?: "applied" | "careers_page";
  ref?: string | null;
  /** Where sign-up returns to, e.g. the careers job page with ?apply=true&ref=… */
  returnTo?: string;
};

const ApplicationSourceContext = createContext<ApplicationSource>({});

/** Wraps a careers job page so its Apply records `careers_page` and the `?ref=`. */
export function ApplicationSourceProvider({ value, children }: { value: ApplicationSource; children: ReactNode }) {
  return <ApplicationSourceContext.Provider value={value}>{children}</ApplicationSourceContext.Provider>;
}

export const useApplicationSource = () => useContext(ApplicationSourceContext);

/** The sign-up link for a signed-out applicant: back to this page (careers) or /jobs/<id>. */
export function useSignUpToApplyHref(allJobsId: string): string {
  const { returnTo } = useApplicationSource();
  return `/auth/sign-up?returnTo=${encodeURIComponent(returnTo ?? `/jobs/${allJobsId}`)}`;
}
