import Link from "next/link";
import { Pencil, PlusCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import RoleLocked from "@/components/team/RoleLocked";
import { forbiddenMessage } from "@/helpers/companies/permissions";

export const NEW_JOB_POST_PATH = "/company/job-posts/new";
export const editJobPostPath = (jobPostId: string) => `/company/job-posts/${jobPostId}/edit`;

/** Opens the new job post page. Locked without jobs.create (TM-REQ-004). */
export function CreateJobPostButton({ disabled = false }: { disabled?: boolean }) {
  const content = (
    <>
      <PlusCircle />
      <span>Create New Job Post</span>
    </>
  );
  if (disabled) {
    return (
      <RoleLocked reason={forbiddenMessage("jobs.create")}>
        <Button variant="brand" className="max-w-full" disabled>
          {content}
        </Button>
      </RoleLocked>
    );
  }
  return (
    <Button asChild variant="brand" className="max-w-full">
      <Link href={NEW_JOB_POST_PATH}>{content}</Link>
    </Button>
  );
}

/** An icon link to a job's Edit section. Locked without jobs.edit on the job. */
export function EditJobPostButton({ jobPostId, disabled = false }: { jobPostId: string; disabled?: boolean }) {
  if (disabled) {
    return (
      <RoleLocked reason={forbiddenMessage("jobs.edit")}>
        <Button variant="ghost" className="text-muted-foreground" aria-label="Edit Job Post" disabled>
          <Pencil className="h-4 w-4" />
        </Button>
      </RoleLocked>
    );
  }
  return (
    <Button asChild variant="ghost" className="text-muted-foreground">
      <Link href={editJobPostPath(jobPostId)} aria-label="Edit Job Post" title="Edit Job Post">
        <Pencil className="h-4 w-4" />
      </Link>
    </Button>
  );
}
