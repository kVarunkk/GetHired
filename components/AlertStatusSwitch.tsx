"use client";

import { Switch } from "./ui/switch";
import { setBookmarkAlertAction } from "@/app/actions/bookmarks/set-bookmark-alert";
import { canAlertOnUrl, MAX_BOOKMARK_ALERTS } from "@/helpers/bookmarks/limits";
import { BookmarkRow } from "@/utils/types";
import toast from "react-hot-toast";

export default function AlertStatusSwitch({
  bookmark,
  updateLocalItem,
  alertCount,
}: {
  bookmark: BookmarkRow;
  updateLocalItem: (updatedItem: BookmarkRow) => void;
  alertCount: number;
}) {
  const checked = bookmark.is_alert_on;

  const handleUpdateStatus = async () => {
    if (!bookmark || !canAlertOnUrl(bookmark.url)) return;

    if (!checked && alertCount >= MAX_BOOKMARK_ALERTS) {
      return toast.error(
        `You can only create a maximum of ${MAX_BOOKMARK_ALERTS} Alerts.`,
      );
    }

    const newStatus = !checked;
    updateLocalItem({ ...bookmark, is_alert_on: newStatus });

    try {
      const result = await setBookmarkAlertAction({
        bookmarkId: bookmark.id,
        on: newStatus,
      });
      if (!result.ok) throw new Error(result.error);

      updateLocalItem(result.bookmark);

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
    } catch (err) {
      updateLocalItem(bookmark);
      toast.error(
        err instanceof Error
          ? err.message
          : "Some error occured while updating the Alert Status.",
      );
    }
  };

  return (
    <div className="flex items-center">
      {canAlertOnUrl(bookmark.url) ? (
        <Switch
          title={`${checked ? "Deactivate" : "Activate"}`}
          checked={checked}
          onCheckedChange={handleUpdateStatus}
        />
      ) : null}
    </div>
  );
}
