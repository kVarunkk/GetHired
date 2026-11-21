import { RESUME_LIMITS } from "@/helpers/resume/config";

/** How long the focus can be in a copy's name before it's cut. */
const FOCUS_NAME_CHARS = 40;

export type CopyNameSource = {
  resumeName: string | null;
  job: { title: string | null; company: string | null } | null;
  focus: string | null;
  pastedJob: boolean;
};

const cut = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);

/** What the copy was tailored for: the job and company, the focus, or a pasted job. */
function tailoredLabel({ job, focus, pastedJob }: CopyNameSource): string {
  const title = job?.title?.trim();
  const company = job?.company?.trim();
  if (title) return company ? `${title} at ${company}` : title;
  const cleanFocus = focus?.trim();
  if (cleanFocus) return cut(cleanFocus, FOCUS_NAME_CHARS);
  return pastedJob ? "Pasted job" : "Improved";
}

/**
 * The name of a tailored copy: "Backend – AI Engineer at Acme". Every copy
 * of one resume used to get the same name ("Backend – Improve Backend" without
 * a job), so the name says what it's tailored for and takes a "(2)", "(3)"…
 * when the user already has a resume of that name. Pure.
 */
export function tailoredCopyName(source: CopyNameSource, existingNames: readonly (string | null)[]): string {
  const max = RESUME_LIMITS.shortFieldChars;
  const base = `${source.resumeName?.trim() || "Untitled resume"} – ${tailoredLabel(source)}`;
  const taken = new Set(existingNames.map((name) => name?.trim().toLowerCase()));
  const withSuffix = (n: number) => {
    const suffix = n === 1 ? "" : ` (${n})`;
    return `${cut(base, max - suffix.length)}${suffix}`;
  };
  for (let n = 1; ; n += 1) {
    const name = withSuffix(n);
    if (!taken.has(name.toLowerCase())) return name;
  }
}
