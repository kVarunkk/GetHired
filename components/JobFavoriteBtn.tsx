"use client";

import { createClient } from "@/lib/supabase/client";
import { User } from "@supabase/supabase-js";
import { Star } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import PropagationStopper from "./StopPropagation";
import { revalidateCache } from "@/app/actions/revalidate";

interface BaseFavorite {
  id: string;
  created_at: string;
  updated_at: string;
  user_id: string;
}

interface IUserFavorites extends BaseFavorite {
  job_id: string;
}

interface IUserFavoritesCompanyInfo extends BaseFavorite {
  company_id: string;
}

export default function JobFavoriteBtn({
  isCompanyUser,
  user,
  userFavorites,
  job_id,
  userFavoritesCompanyInfo,
  company_id,
}: //   isFavorite,
{
  isCompanyUser: boolean;
  user: User | null;
  userFavorites?: IUserFavorites[];
  job_id?: string;
  userFavoritesCompanyInfo?: IUserFavoritesCompanyInfo[];
  company_id?: string;
  //   isFavorite: boolean;
}) {
  const [isFavorite, setIsFavorite] = useState(false);
  const supabase = createClient();

  const isCompanyMode = !!company_id && !job_id;

  const {
    currentFavoritesList,
    targetId,
    tableName,
    targetIdKey,
    revalidateTag,
  } = useMemo(() => {
    if (isCompanyMode) {
      return {
        currentFavoritesList: userFavoritesCompanyInfo || [],
        targetId: company_id,
        tableName: "user_favorites_companies",
        targetIdKey: "company_id",
        revalidateTag: "companies-feed",
      };
    }
    return {
      currentFavoritesList: userFavorites || [],
      targetId: job_id,
      tableName: "user_favorites",
      targetIdKey: "job_id",
      revalidateTag: "jobs-feed",
    };
  }, [
    isCompanyMode,
    job_id,
    company_id,
    userFavorites,
    userFavoritesCompanyInfo,
  ]);

  useEffect(() => {
    if (user && targetId) {
      const isCurrentlyFavorited = currentFavoritesList.some(
        (fav) =>
          fav.user_id === user.id &&
          (isCompanyMode
            ? (fav as IUserFavoritesCompanyInfo).company_id === company_id
            : (fav as IUserFavorites).job_id === job_id)
      );

      setIsFavorite(isCurrentlyFavorited);
    } else {
      setIsFavorite(false);
    }
  }, [user, targetId, currentFavoritesList, isCompanyMode, company_id, job_id]);

  const handleFavorite = async () => {
    if (!user) return;
    setIsFavorite((prev) => !prev);

    try {
      const isCurrentlyFavorited = currentFavoritesList.some(
        (fav) =>
          fav.user_id === user.id &&
          (isCompanyMode
            ? (fav as IUserFavoritesCompanyInfo).company_id === targetId
            : (fav as IUserFavorites).job_id === targetId)
      );

      let query;

      if (isCurrentlyFavorited) {
        query = supabase
          .from(tableName)
          .delete()
          .eq("user_id", user.id)
          .eq(targetIdKey, targetId);
      } else {
        const insertObject: Record<string, string | undefined> = {
          user_id: user.id,
        };
        insertObject[targetIdKey] = targetId;

        query = supabase.from(tableName).insert([insertObject]);
      }

      const { error } = await query;

      if (error) throw new Error(error.message);
      await revalidateCache(revalidateTag);
    } catch {
      // console.error("Favorite action failed:", e);
      setIsFavorite((prev) => !prev);
    }
  };
  return (
    <PropagationStopper className="!ml-3 inline-block align-middle">
      {/* <div > */}
      {isCompanyUser ? (
        ""
      ) : user ? (
        <button
          onClick={() => {
            // e.stopPropagation();
            handleFavorite();
          }}
        >
          <Star
            className={`${isFavorite && "fill-black dark:fill-white"} h-5 w-5`}
          />
        </button>
      ) : (
        <Link
          onClick={(e) => e.stopPropagation()}
          href={
            "/auth/sign-up?returnTo=" +
            (isCompanyMode ? "/companies/" + company_id : "/jobs/" + job_id)
          }
        >
          <Star className="h-5 w-5" />
        </Link>
      )}
      {/* </div> */}
    </PropagationStopper>
  );
}
