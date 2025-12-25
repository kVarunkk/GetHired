"use client";

import { Bookmark } from "lucide-react";
import { Button } from "./ui/button";
import { useEffect, useState } from "react";
import { User } from "@supabase/supabase-js";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { usePathname } from "next/navigation";
import toast from "react-hot-toast";
import { v4 as uuidv4 } from "uuid";

export default function BookmarkJobSearch({ user }: { user: User }) {
  const [bookmarked, setBookmarked] = useState(false);
  const [loading, setLoading] = useState(false);
  const pathname = usePathname();

  const fullUrl =
    typeof window !== "undefined"
      ? window.location.pathname + window.location.search
      : pathname;

  useEffect(() => {
    const supabase = createClient();
    if (!user || !pathname) return;

    const checkBookmark = async () => {
      if (!user?.id || !fullUrl) return;

      setLoading(true);
      try {
        const { data, error } = await supabase
          .from("bookmarks")
          .select("id")
          .eq("user_id", user.id)
          .eq("url", fullUrl)
          .maybeSingle();

        if (error) throw error;

        setBookmarked(!!data);
      } catch (error) {
        setBookmarked(false);
      } finally {
        setLoading(false);
      }
    };

    checkBookmark();
  }, [user, fullUrl, pathname]);

  const handleBookmark = async () => {
    try {
      if (!user || !fullUrl) return;
      const supabase = createClient();
      setLoading(true);

      if (bookmarked) {
        // Remove bookmark
        const { error } = await supabase
          .from("bookmarks")
          .delete()
          .eq("user_id", user.id)
          .eq("url", fullUrl);
        if (error) throw error;
        setBookmarked(false);
      } else {
        // Add bookmark
        const { error } = await supabase.from("bookmarks").insert({
          user_id: user.id,
          url: fullUrl,
          name: `Saved Search ${uuidv4()}`,
        });
        if (error) throw error;
        setBookmarked(true);
      }
      toast.success(bookmarked ? "Bookmark removed" : "Bookmark added");
      setLoading(false);
    } catch {
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
