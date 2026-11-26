import { redirect } from "next/navigation";
import { jobImportPath } from "@/helpers/candidates/paths";

/** The section opens on Resumes (CP-DEC-004), keeping the query so old links still work. */
export default async function JobImportPage({
  params,
  searchParams,
}: {
  params: Promise<{ job_id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ job_id }, query] = await Promise.all([params, searchParams]);
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    for (const v of Array.isArray(value) ? value : value === undefined ? [] : [value]) qs.append(key, v);
  }
  const search = qs.toString();
  redirect(`${jobImportPath(job_id)}${search ? `?${search}` : ""}`);
}
