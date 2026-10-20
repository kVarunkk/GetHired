"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import toast from "react-hot-toast";
import { saveSchedulingLinkAction } from "@/app/actions/pipeline/save-scheduling-link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const HTTPS_URL = /^https:\/\/[^\s<>"]+$/;

/** Company settings: the scheduling link that `{{scheduling_link}}` inserts (PL-REQ-008). */
export default function SchedulingLinkForm({ initial }: { initial: string | null }) {
  const [url, setUrl] = useState(initial ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const valid = url.trim() === "" || HTTPS_URL.test(url.trim());

  const save = async () => {
    setIsSaving(true);
    try {
      const result = await saveSchedulingLinkAction({ schedulingUrl: url.trim() });
      if (result.ok) toast.success(url.trim() ? "Scheduling link saved." : "Scheduling link removed.");
      else toast.error(result.error);
    } catch {
      toast.error("Couldn't save the link. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="Scheduling link"
          placeholder="https://cal.com/your-team/intro"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="max-w-md"
        />
        <Button disabled={!valid || isSaving} onClick={() => void save()}>
          {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save link
        </Button>
      </div>
      {!valid && <p className="text-sm text-destructive">Use a link that starts with https://.</p>}
    </div>
  );
}
