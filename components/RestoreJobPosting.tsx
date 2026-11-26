"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { ArchiveRestore, Loader2 } from "lucide-react";
import { restoreJobPostingAction } from "@/app/actions/delete-job-posting";
import { forbiddenMessage } from "@/helpers/companies/permissions";
import { Button } from "./ui/button";
import RoleLocked from "./team/RoleLocked";

/** Brings an archived job post back to the company's lists. It stays closed until published. */
export default function RestoreJobPosting({ job_posting_id, disabled = false }: { job_posting_id: string; disabled?: boolean }) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const restore = async () => {
    setLoading(true);
    try {
      const result = await restoreJobPostingAction({ jobPostingId: job_posting_id });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Job post restored. It's closed until you publish it.");
      router.refresh();
    } catch {
      toast.error("Failed to restore the job post.");
    } finally {
      setLoading(false);
    }
  };

  const button = (
    <Button variant="outline" size="sm" onClick={() => void restore()} disabled={disabled || loading}>
      {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArchiveRestore className="mr-2 h-4 w-4" />}
      Restore
    </Button>
  );

  return disabled ? <RoleLocked reason={forbiddenMessage("jobs.delete")}>{button}</RoleLocked> : button;
}
