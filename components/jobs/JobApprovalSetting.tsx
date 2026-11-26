"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { setJobApprovalRequiredAction } from "@/app/actions/set-job-approval-required";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

/**
 * Settings → Jobs (JL-REQ-018): whether a job needs `jobs.approve` before it
 * opens for the first time. Only owners change it (D7); others see it
 * disabled inside a read-only `fieldset`.
 */
export default function JobApprovalSetting({ initial }: { initial: boolean }) {
  const [required, setRequired] = useState(initial);
  const [saving, setSaving] = useState(false);

  const save = async (next: boolean) => {
    setRequired(next);
    setSaving(true);
    try {
      const result = await setJobApprovalRequiredAction({ required: next });
      if (result.ok) {
        toast.success(next ? "Job posts now need approval before they open." : "Job posts no longer need approval.");
      } else {
        setRequired(!next);
        toast.error(result.error);
      }
    } catch {
      setRequired(!next);
      toast.error("Couldn't save the setting. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <Switch
          id="job-approval-required"
          checked={required}
          disabled={saving}
          onCheckedChange={(checked) => void save(checked)}
        />
        <Label htmlFor="job-approval-required">Require approval before a job post opens</Label>
      </div>
      <p className="text-sm text-muted-foreground">
        Members who can&apos;t approve job posts submit them for approval instead of publishing. Members who can approve
        publish directly. Reopening a paused or closed job never needs approval. Turning this off leaves jobs that are
        waiting for approval as they are.
      </p>
    </div>
  );
}
