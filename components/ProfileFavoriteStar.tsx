"use client";

import { createClient } from "@/lib/supabase/client";
import { PROFILE_API_KEY } from "@/utils/utils";
import { Star } from "lucide-react";
import toast from "react-hot-toast";
import { mutate } from "swr";

export default function ProfileFavoriteStar({
  profileId,
  companyId,
  isFavorite,
}: {
  profileId: string;
  companyId?: string;
  isFavorite: boolean;
}) {
  const handleFavorite = async () => {
    if (!companyId || !profileId) return;

    const nextFavoriteState = !isFavorite;

    mutate(
      PROFILE_API_KEY,
      (currentData) => {
        if (!currentData) return currentData;

        const profile = currentData.profile || {};

        const currentProfiles = profile.company_favorites || [];

        let updatedProfiles = [...currentProfiles];

        if (nextFavoriteState) {
          if (!updatedProfiles.some((p) => p.user_id === profileId)) {
            updatedProfiles.push({ user_id: profileId });
          }
        } else {
          updatedProfiles = updatedProfiles.filter(
            (p) => p.user_id !== profileId,
          );
        }

        return {
          ...currentData,
          profile: {
            ...profile,
            company_favorites: updatedProfiles,
          },
        };
      },
      false,
    );

    try {
      const supabase = createClient();

      if (!nextFavoriteState) {
        await supabase
          .from("company_favorites")
          .delete()
          .eq("user_id", profileId)
          .eq("company_id", companyId);
      } else {
        await supabase
          .from("company_favorites")
          .insert([{ user_id: profileId, company_id: companyId }]);
      }

      mutate(PROFILE_API_KEY);
    } catch {
      toast.error("Failed to update favorite status.");
      mutate(PROFILE_API_KEY);
    }
  };

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        handleFavorite();
      }}
      className="ml-3"
    >
      <Star
        className={`${isFavorite && "fill-black dark:fill-white"} h-5 w-5`}
      />
    </button>
  );
}
