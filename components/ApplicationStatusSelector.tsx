"use client";

import { useState, useCallback } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Loader2 } from "lucide-react";
import { cn } from "@/utils/utils";
import { TApplicationStatus } from "@/utils/types";
import { updateApplicationStatusAction } from "@/app/actions/update-application-status";
import toast from "react-hot-toast";
import { TApplication1 } from "@/utils/types/jobs.types";

// Define the available application statuses
const applicationStatuses = Object.values(TApplicationStatus);

export default function ApplicationStatusSelect({
  application,
}: {
  application: TApplication1;
}) {
  const [currentStatus, setCurrentStatus] = useState(application.status);
  const [isUpdating, setIsUpdating] = useState(false);

  const handleStatusUpdate = useCallback(
    async (newStatus: TApplicationStatus) => {
      const previous = currentStatus;
      setCurrentStatus(newStatus);
      setIsUpdating(true);
      try {
        const result = await updateApplicationStatusAction({
          applicationId: application.id,
          status: newStatus,
        });
        if (result.ok) {
          toast.success("Status updated.");
        } else {
          setCurrentStatus(previous);
          toast.error(result.error);
        }
      } catch {
        setCurrentStatus(previous);
        toast.error("Couldn't update the status. Please try again.");
      } finally {
        setIsUpdating(false);
      }
    },
    [application.id, currentStatus],
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
          className={cn("w-[180px] capitalize", isUpdating && "opacity-50")}
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
