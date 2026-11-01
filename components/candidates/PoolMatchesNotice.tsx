"use client";

import { useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { jobPoolMatchesPath } from "@/helpers/jobs/paths";

/**
 * After a job is created (CP-REQ-061): "N people in your candidates may fit
 * this job", linking to the job's "From your candidates" section. Dismissing
 * it only hides it here.
 */
export default function PoolMatchesNotice({ jobId, count }: { jobId: string; count: number }) {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  return (
    <div role="status" className="flex items-center justify-between gap-3 rounded-xl border p-4 text-sm">
      <p>
        {count === 1 ? "1 person" : `${count} people`} in your candidates may fit this job.{" "}
        <Link href={jobPoolMatchesPath(jobId)} className="font-medium underline underline-offset-4">
          See {count === 1 ? "them" : "who"}
        </Link>
      </p>
      <Button size="icon" variant="ghost" aria-label="Dismiss" onClick={() => setOpen(false)}>
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
