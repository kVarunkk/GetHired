// Client-safe. Every link into My Jobs is built here (AT-REQ-012).

export const MY_JOBS_PATH = "/my-jobs";

export type MyJobsTab = "applications" | "saved";
export type MyJobsView = "board" | "list";

export function myJobsPath({ tab, view, q }: { tab?: MyJobsTab; view?: MyJobsView; q?: string | null } = {}): string {
  const params = new URLSearchParams();
  if (tab && tab !== "applications") params.set("tab", tab);
  if (view && view !== "board" && tab !== "saved") params.set("view", view);
  if (q?.trim()) params.set("q", q.trim());
  const query = params.toString();
  return query ? `${MY_JOBS_PATH}?${query}` : MY_JOBS_PATH;
}

/** The Add job page; `saved` starts the status as Saved (the Saved tab), else Applied. */
export const ADD_JOB_PATH = `${MY_JOBS_PATH}/add`;
export const addJobPath = (status: "saved" | "applied" = "applied") =>
  status === "saved" ? `${ADD_JOB_PATH}?status=saved` : ADD_JOB_PATH;

/** A card's page: a tracked row's id, or a GetHired `applications.id`. */
export const trackedApplicationPath = (id: string) => `${MY_JOBS_PATH}/applications/${encodeURIComponent(id)}`;

export const parseMyJobsTab = (value: string | string[] | undefined): MyJobsTab =>
  value === "saved" ? "saved" : "applications";

export const parseMyJobsView = (value: string | string[] | undefined): MyJobsView => (value === "list" ? "list" : "board");
