"use client";

import { createClient } from "@/lib/supabase/client";
import { User } from "@supabase/supabase-js";
import { Star } from "lucide-react";
import Link from "next/link";
import { startTransition, useMemo, useOptimistic } from "react";
import PropagationStopper from "./StopPropagation";
import { revalidateCache } from "@/app/actions/revalidate";
import { IUserFavorites, IUserFavoritesCompanyInfo } from "@/utils/types";

function isCompanyFavorite(
  fav: IUserFavoritesCompanyInfo | IUserFavorites,
): fav is IUserFavoritesCompanyInfo {
  return "company_id" in fav;
}

export default function JobFavoriteBtn({
  isCompanyUser,
  user,
  userFavorites,
  job_id,
  userFavoritesCompanyInfo,
  company_id,
}: {
  isCompanyUser: boolean;
  user: User | null;
  userFavorites?: IUserFavorites[];
  job_id?: string;
  userFavoritesCompanyInfo?: IUserFavoritesCompanyInfo[];
  company_id?: string;
}) {
  const supabase = createClient();
  const isCompanyMode = !!company_id && !job_id;
  const targetId = isCompanyMode ? company_id : job_id;
  const tableName = isCompanyMode
    ? "user_favorites_companies"
    : "user_favorites";
  const targetIdKey = isCompanyMode ? "company_id" : "job_id";
  const revalidateTag = isCompanyMode ? `companies-feed` : `jobs-feed`;

  const isActuallyFavorited = useMemo(() => {
    if (!user || !targetId) return false;
    const list = isCompanyMode ? userFavoritesCompanyInfo : userFavorites;
    return list?.some(
      (fav) =>
        fav.user_id === user.id &&
        (isCompanyFavorite(fav)
          ? fav.company_id === targetId
          : fav.job_id === targetId),
    );
  }, [
    user,
    targetId,
    userFavorites,
    userFavoritesCompanyInfo,
    isCompanyMode,
    targetIdKey,
  ]);

  const [optimisticFavorite, toggleOptimistic] = useOptimistic(
    isActuallyFavorited,
    (state, newState: boolean) => newState,
  );

  const handleFavorite = async () => {
    if (!user || !targetId) return;

    startTransition(async () => {
      const nextState = !optimisticFavorite;
      toggleOptimistic(nextState);

      try {
        if (optimisticFavorite) {
          await supabase
            .from(tableName)
            .delete()
            .eq("user_id", user.id)
            .eq(targetIdKey, targetId);
        } else {
          await supabase
            .from(tableName)
            .insert([{ user_id: user.id, [targetIdKey]: targetId }]);
        }
        await revalidateCache(revalidateTag);
      } catch {}
    });
  };
  return (
    <PropagationStopper className="!ml-3 inline-block align-middle">
      {isCompanyUser ? null : user ? (
        <button
          onClick={() => {
            handleFavorite();
          }}
        >
          <Star
            className={`${optimisticFavorite && "fill-black dark:fill-white"} h-5 w-5`}
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
    </PropagationStopper>
  );
}
