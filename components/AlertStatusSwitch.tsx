"use client";

import { useEffect, useState } from "react";
import { Switch } from "./ui/switch";
import { IBookmark } from "@/lib/types";
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
  const [checkedState, setCheckedState] = useState(bookmark.is_alert_on);

  useEffect(() => {
    setCheckedState(bookmark.is_alert_on);
  }, [bookmark.is_alert_on]);

  const handleUpdateStatus = async () => {
    if (!bookmark || bookmark.url.includes("sortBy=relevance")) return;

    if (!checkedState && alertCount >= MAX_ALERTS) {
      return toast.error(
        "You can only create a maximum of " + MAX_ALERTS + " Alerts."
      );
    }

    const supabase = createClient();

    setCheckedState(!checkedState);

    try {
      const { data, error } = await supabase
        .from("bookmarks")
        .update({
          is_alert_on: !checkedState,
        })
        .eq("id", bookmark.id)
        .select("*")
        .single();

      if (error) throw error;

      updateLocalItem(data);

      toast.success(
        !checkedState ? (
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
        }
      );
    } catch {
      setCheckedState(checkedState);
      toast.error("Some error occured while updating the Alert Status.");
    }
  };

  return (
    <div className="flex items-center">
      {bookmark.url && !bookmark.url.includes("sortBy=relevance") ? (
        <Switch
          title={`${checkedState ? "Deactivate" : "Activate"}`}
          checked={checkedState}
          onCheckedChange={handleUpdateStatus}
        />
      ) : (
        ""
      )}
    </div>
  );
}
