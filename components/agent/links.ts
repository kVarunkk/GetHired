/** Links in agent replies open in a new tab, so the chat stays put. */
export const NEW_TAB = { target: "_blank", rel: "noopener noreferrer" } as const;

const APP_ORIGIN = "https://gethired.devhub.co.in";

/** A link into the app: a relative path, or the app's own origin (SEC-014). */
export function isInAppHref(href: string | undefined) {
  if (!href) return false;
  if (href.startsWith("/")) return !href.startsWith("//") && !href.startsWith("/\\");
  try {
    return new URL(href).origin === APP_ORIGIN;
  } catch {
    return false;
  }
}

export const inlineLink = "font-medium text-foreground underline underline-offset-4 hover:text-brand";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
/** A markdown link target: `](...)`, up to the first `)`. */
const LINK_TARGET = /\]\(([^()\n]*)\)/g;
/** A job id inside a broken target: after `jobs/` or the model's `jobId:`. */
const JOB_ID = new RegExp(`(?:jobs/|jobId:\\s*)(${UUID})`, "i");
/** A bare id with no path, e.g. the model's `Mo: <id>`. */
const BARE_ID = new RegExp(`(?<![\\w-])(${UUID})(?![\\w-])`, "gi");

/**
 * The job id in a broken target: one after `jobs/` or `jobId:`, or else the
 * only id in a target with no path. Jobs are the one thing replies link by
 * bare id, so it's read as a job; a target with another path
 * (`Mo: /resume/<id>`) or several ids isn't.
 */
function brokenTargetJobId(target: string): string | undefined {
  const id = JOB_ID.exec(target)?.[1];
  if (id) return id;
  if (target.includes("/")) return undefined;
  const bare = target.match(BARE_ID);
  return bare?.length === 1 ? bare[0] : undefined;
}

/**
 * Repairs the job links the model sometimes writes wrong (agent chat review
 * 2026-11-14/15, problem 2): `EE /jobs/<id>`, `//jobs/<id>`, a tool call such
 * as `invocation:default_api:getJobDetails{jobId:<id>}`, stray text before
 * the path, or a bare id (`Mo: <id>`, session c19ffb8b on 2026-11-21). Each
 * becomes `/jobs/<id>`. A target that's already a working in-app link, or
 * that names no job, is left alone (an outside link still renders as plain
 * text). Runs before markdown parsing, since a target with a space isn't a
 * link at all. Pure.
 */
export function repairJobLinks(text: string): string {
  if (!text.includes("](")) return text;
  return text.replace(LINK_TARGET, (whole, target: string) => {
    if (isInAppHref(target) && !/\s/.test(target)) return whole;
    const id = brokenTargetJobId(target);
    return id ? `](/jobs/${id.toLowerCase()})` : whole;
  });
}
