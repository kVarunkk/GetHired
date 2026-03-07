"use client";

import { Switch } from "./ui/switch";
import { IBookmark } from "@/utils/types";
import { createClient } from "@/lib/supabase/client";
import toast from "react-hot-toast";

const MAX_ALERTS = 5;

export default function AlertStatusSwitch({
  bookmark,
  updateLocalItem,
  alertCount,
}: {
  bookmark: IBookmark;
  updateLocalItem: (updatedItem: IBookmark) => void;
  alertCount: number;
}) {
  const checked = bookmark.is_alert_on;

  const handleUpdateStatus = async () => {
    if (!bookmark || bookmark.url.includes("sortBy=relevance")) return;

    if (!checked && alertCount >= MAX_ALERTS) {
      return toast.error(
        `You can only create a maximum of ${MAX_ALERTS} Alerts.`,
      );
    }

    const newStatus = !checked;
    updateLocalItem({ ...bookmark, is_alert_on: newStatus });

    try {
      const supabase = createClient();

      const { data, error } = await supabase
        .from("bookmarks")
        .update({
          is_alert_on: newStatus,
        })
        .eq("id", bookmark.id)
        .select("*")
        .single();

      if (error) throw error;

      updateLocalItem(data);

      toast.success(
        newStatus ? (
          <p className="leading-relaxed">
            You have enabled Alert for the Bookmark:{" "}
            <span className="break-words">{bookmark.name}</span> 🎉. You will
            receive weekly Job Alerts for this bookmark on your registered
            email.
          </p>
        ) : (
          <p className="leading-relaxed">
            You have disabled Alert for the Bookmark:{" "}
            <span className="break-words">{bookmark.name}</span>. Weekly Job
            Alerts for this bookmark will stop.
          </p>
        ),
        {
          duration: 6000,
        },
      );
    } catch {
      updateLocalItem(bookmark);
      toast.error("Some error occured while updating the Alert Status.");
    }
  };

  return (
    <div className="flex items-center">
      {bookmark.url && !bookmark.url.includes("sortBy=relevance") ? (
        <Switch
          title={`${checked ? "Deactivate" : "Activate"}`}
          checked={checked}
          onCheckedChange={handleUpdateStatus}
        />
      ) : null}
    </div>
  );
}
