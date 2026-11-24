import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { normalizeJobUrl, parseGetHiredJobUrl } from "./job-url";

/**
 * The spellings of a link that `all_jobs.job_url` (unique) might hold:
 * with and without `www.` and a trailing slash, and the link as given.
 */
export function jobUrlCandidates(url: string): string[] {
  const key = normalizeJobUrl(url);
  if (!key) return [];
  const [hostPath, query] = key.split("?");
  const suffix = query ? `?${query}` : "";
  const out = new Set<string>([url.trim()]);
  for (const host of [hostPath, `www.${hostPath}`]) {
    out.add(`https://${host}${suffix}`);
    out.add(`https://${host}/${suffix}`);
  }
  return [...out].slice(0, 10);
}

/**
 * The board job a link points to (AT-REQ-031 step 1): a GetHired job page, or
 * a job whose `all_jobs.job_url` is the same link. `job_url` isn't readable
 * by users, so the lookup uses the service role and returns only the id.
 */
export async function findBoardJobIdByUrl(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  const gethiredId = parseGetHiredJobUrl(url);
  if (gethiredId) return gethiredId;

  const candidates = jobUrlCandidates(url);
  if (candidates.length === 0) return null;
  const { data, error } = await createServiceRoleClient()
    .from("all_jobs")
    .select("id")
    .in("job_url", candidates)
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return data.id;
}
