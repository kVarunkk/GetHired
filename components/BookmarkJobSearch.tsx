"use client";

import { reportClientError } from "@/lib/posthog/report-client-error";
import { Bookmark } from "lucide-react";
import { Button } from "./ui/button";
import { useEffect, useState } from "react";
import { User } from "@supabase/supabase-js";
import { cn } from "@/utils/utils";
import { createClient } from "@/lib/supabase/client";
import { usePathname, useSearchParams } from "next/navigation";
import toast from "react-hot-toast";
import { toggleSearchBookmarkAction } from "@/app/actions/bookmarks/toggle-search-bookmark";

export default function BookmarkJobSearch({ user }: { user: User }) {
  const [bookmarked, setBookmarked] = useState(false);
  const [loading, setLoading] = useState(false);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const fullUrl = `${pathname}?${searchParams.toString()}`;

  useEffect(() => {
    if (!user) return;

    const checkBookmark = async () => {
      if (!user?.id || !fullUrl) return;

      setLoading(true);
      try {
        const supabase = createClient();
        const { data } = await supabase
          .from("bookmarks")
          .select("id")
          .eq("user_id", user.id)
          .eq("url", fullUrl)
          .maybeSingle();

        setBookmarked(!!data);
      } catch (error) {
        reportClientError("[bookmarks] couldn't check the bookmark", error);
        setBookmarked(false);
      } finally {
        setLoading(false);
      }
    };

    checkBookmark();
  }, [user, fullUrl]);

  const handleBookmark = async () => {
    try {
      if (!user || !fullUrl) return;
      setLoading(true);

      const result = await toggleSearchBookmarkAction({ url: fullUrl });
      if (!result.ok) throw new Error(result.error);

      setBookmarked(result.bookmarked);
      toast.success(result.bookmarked ? "Bookmark added" : "Bookmark removed");
      setLoading(false);
    } catch (err) {
      if (err instanceof Error) toast.error(err.message);
      setLoading(false);
    }
  };

  return (
    <Button
      title="Bookmark"
      variant="ghost"
      onClick={handleBookmark}
      disabled={loading || !user}
    >
      <Bookmark
        className={cn("h-4 w-4", bookmarked && "fill-current text-primary")}
      />
    </Button>
  );
}
