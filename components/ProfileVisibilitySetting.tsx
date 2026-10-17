"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { createClient } from "@/lib/supabase/client";
import { revalidateCacheAction } from "@/app/actions/revalidate-tag";
import { Badge } from "./ui/badge";
import { Label } from "./ui/label";
import { Switch } from "./ui/switch";
import {
  PROFILE_VISIBILITY_DETAILS,
  PROFILE_VISIBILITY_LABEL,
} from "./profile-visibility-copy";

/** The applicant's own "public profile" switch on /settings (spec §3.6). */
export default function ProfileVisibilitySetting({
  userId,
  initialIsPublic,
  onChange,
}: {
  userId: string;
  initialIsPublic: boolean;
  /** Called with the saved value, and again with the old one if saving fails. */
  onChange?: (isPublic: boolean) => void;
}) {
  const [isPublic, setIsPublic] = useState(initialIsPublic);
  const [saving, setSaving] = useState(false);

  const handleChange = async (next: boolean) => {
    const previous = isPublic;
    setIsPublic(next);
    onChange?.(next);
    setSaving(true);
    try {
      const { error } = await createClient()
        .from("user_info")
        .update({ is_public: next })
        .eq("user_id", userId);
      if (error) throw error;

      await revalidateCacheAction(`profile-${userId}`);
      toast.success(next ? "Your profile is now public." : "Your profile is now hidden.");
    } catch {
      setIsPublic(previous);
      onChange?.(previous);
      toast.error("Couldn't update your profile visibility. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="settings_profile_visibility" className="text-sm font-medium">
          {PROFILE_VISIBILITY_LABEL}
        </Label>
        <Switch
          id="settings_profile_visibility"
          aria-describedby="settings_profile_visibility_details"
          checked={isPublic}
          disabled={saving}
          onCheckedChange={handleChange}
        />
      </div>
      <p id="settings_profile_visibility_details" className="text-sm text-muted-foreground">
        {PROFILE_VISIBILITY_DETAILS}
      </p>
      <Badge variant={isPublic ? "brand" : "outline"} className="w-fit">
        {isPublic ? "Public" : "Hidden"}
      </Badge>
    </div>
  );
}
