"use client";

import { revalidateCache } from "@/app/actions/revalidate";
import { createClient } from "@/lib/supabase/client";
import { IFormData } from "@/utils/types";
import { Star } from "lucide-react";
import { useEffect, useState } from "react";

export default function ProfileFavoriteStar({
  profile,
  companyId,
}: {
  profile: IFormData;
  companyId?: string;
}) {
  const supabase = createClient();
  const [isFavorite, setIsFavorite] = useState(false);

  useEffect(() => {
    if (profile && companyId) {
      if (
        profile.company_favorites &&
        profile.company_favorites.filter(
          (each) => each.company_id === companyId,
        ).length > 0
      ) {
        setIsFavorite(true);
      }
    }
  }, [profile, companyId]);

  const handleFavorite = async () => {
    try {
      let query;

      if (!companyId) throw new Error("Company info not found");

      if (
        profile.company_favorites &&
        profile.company_favorites.filter(
          (each) => each.company_id === companyId,
        ).length > 0
      ) {
        query = supabase
          .from("company_favorites")
          .delete()
          .eq("user_info_id", profile.user_id)
          .eq("company_id", companyId);
      } else
        query = supabase.from("company_favorites").insert([
          {
            user_info_id: profile.user_id,
            company_id: companyId,
          },
        ]);

      const { error } = await query;

      if (error) throw new Error(error.details);
      await revalidateCache("profiles-feed");
    } catch {
      // console.error(e);
    }
  };

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        setIsFavorite(!isFavorite);
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
