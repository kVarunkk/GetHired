"use client";

import Link from "next/link";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { myApplicationHref } from "@/helpers/tracker/applied-state";
import { fetcher, PROFILE_API_KEY } from "@/utils/utils";

/**
 * On a job that's no longer open, a link to the applicant's own record of it
 * in My Jobs, so someone who applied isn't stranded. Nothing for anyone else.
 */
export default function MyApplicationLink({ jobId }: { jobId: string }) {
  const { data: currentUser } = useSWR(PROFILE_API_KEY, fetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    dedupingInterval: 5 * 60 * 1000,
  });
  const href = currentUser?.role === "applicant" ? myApplicationHref(currentUser.profile, jobId) : null;
  if (!href) return null;
  return (
    <Button asChild variant="brand">
      <Link href={href}>View your application</Link>
    </Button>
  );
}
