"use client";

import { useState, useCallback } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { createClient } from "@/lib/supabase/client";
import { Loader2 } from "lucide-react";
import { cn } from "@/utils/utils";
import { IApplication, TApplicationStatus } from "@/utils/types";
import { sendStatusUpdateEmail } from "@/app/actions/send-email";

// Define the available application statuses
const applicationStatuses = Object.values(TApplicationStatus);

export default function ApplicationStatusSelect({
  application,
}: {
  application: IApplication;
}) {
  const [currentStatus, setCurrentStatus] = useState(application.status);
  const [isUpdating, setIsUpdating] = useState(false);
  const supabase = createClient();

  const handleStatusUpdate = useCallback(
    async (newStatus: TApplicationStatus) => {
      setIsUpdating(true);
      try {
        const { error } = await supabase
          .from("applications")
          .update({ status: newStatus })
          .eq("id", application.id);

        if (error) throw error;

        if (
          application.user_info &&
          application.job_postings &&
          application.job_postings.company_info
        ) {
          sendStatusUpdateEmail(
            application.user_info.email,
            newStatus,
            application.job_postings?.title,
            application.job_postings?.company_info?.name,
          );
        }

        setCurrentStatus(newStatus);
        // toast.success("Application status updated successfully!");
      } catch {
        // console.error("Failed to update application status:", error);
        // toast.error("Failed to update status. Please try again.");
      } finally {
        setIsUpdating(false);
      }
    },
    [application.id, supabase],
  );

  return (
    <div className="relative flex items-center gap-1">
      <span className="text-sm font-medium">Status:</span>
      <Select
        value={currentStatus}
        onValueChange={handleStatusUpdate}
        disabled={isUpdating}
      >
        <SelectTrigger
          className={cn(
            "w-[180px] capitalize bg-input",
            isUpdating && "opacity-50",
          )}
        >
          <SelectValue placeholder="Update Status" />
        </SelectTrigger>
        <SelectContent>
          {applicationStatuses.map((status) => (
            <SelectItem key={status} value={status} className="capitalize">
              {status}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {isUpdating && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/50">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
        </div>
      )}
    </div>
  );
}
