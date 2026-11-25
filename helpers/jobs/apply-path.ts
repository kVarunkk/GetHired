import { careersPath } from "@/helpers/careers/slug";
import { sourceTagQuery, type SourceTag } from "@/helpers/distribution/source-tag";

/** AP-REQ-001: a platform job's apply page; `tag` keeps a feed's `?src=&pid=` (MP-REQ-006). Client-safe. */
export function jobApplyPath(jobId: string, tag?: SourceTag | null): string {
  const query = sourceTagQuery(tag ?? null);
  return `/jobs/${jobId}/apply${query ? `?${query}` : ""}`;
}

/** AP-REQ-002: the same page inside a company's careers page; `ref` is the `?ref=` tag. */
export function careersApplyPath(slug: string, jobId: string, ref?: string | null): string {
  return `${careersPath(slug)}/jobs/${jobId}/apply${ref ? `?ref=${encodeURIComponent(ref)}` : ""}`;
}
