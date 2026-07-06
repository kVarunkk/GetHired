"use client";

import { createClient } from "@/lib/supabase/client";
import { Star } from "lucide-react";
import Link from "next/link";
import PropagationStopper from "./StopPropagation";
import toast from "react-hot-toast";
import { mutate } from "swr";
import { PROFILE_API_KEY } from "@/utils/utils";

export default function JobFavoriteBtn({
  isCompanyUser,
  userId,
  job_id,
  company_id,
  isFavorite,
}: {
  isCompanyUser: boolean;
  userId: string | null;
  job_id?: string;
  company_id?: string;
  isFavorite: boolean;
}) {
  const isCompanyMode = !!company_id && !job_id;
  const targetId = isCompanyMode ? company_id : job_id;

  const handleFavorite = async () => {
    if (!userId || !targetId) return;

    const nextFavoriteState = !isFavorite;

    mutate(
      PROFILE_API_KEY,
      (currentData) => {
        if (!currentData) return currentData;

        const profile = currentData.profile || {};

        const currentJobs = profile.user_favorites || [];
        const currentCompanies = profile.user_favorites_companies || [];

        let updatedJobs = [...currentJobs];
        let updatedCompanies = [...currentCompanies];

        if (isCompanyMode) {
          // --- COMPANY CASE ---
          if (nextFavoriteState) {
            if (!updatedCompanies.some((c) => c.company_id === targetId)) {
              updatedCompanies.push({ company_id: targetId });
            }
          } else {
            updatedCompanies = updatedCompanies.filter(
              (c) => c.company_id !== targetId,
            );
          }
        } else {
          // --- JOB CASE ---
          if (nextFavoriteState) {
            if (!updatedJobs.some((j) => j.job_id === targetId)) {
              updatedJobs.push({ job_id: targetId });
            }
          } else {
            updatedJobs = updatedJobs.filter((j) => j.job_id !== targetId);
          }
        }

        return {
          ...currentData,
          profile: {
            ...profile,
            user_favorites: updatedJobs,
            user_favorites_companies: updatedCompanies,
          },
        };
      },
      false,
    );

    try {
      const supabase = createClient();

      if (!nextFavoriteState) {
        // DELETE Paths
        if (isCompanyMode) {
          await supabase
            .from("user_favorites_companies")
            .delete()
            .eq("user_id", userId)
            .eq("company_id", targetId);
        } else {
          await supabase
            .from("user_favorites")
            .delete()
            .eq("user_id", userId)
            .eq("job_id", targetId);
        }
      } else {
        // INSERT Paths
        if (isCompanyMode) {
          await supabase
            .from("user_favorites_companies")
            .insert([{ user_id: userId, company_id: targetId }]);
        } else {
          await supabase
            .from("user_favorites")
            .insert([{ user_id: userId, job_id: targetId }]);
        }
      }

      mutate(PROFILE_API_KEY);
    } catch {
      toast.error("Failed to update favorite status.");
      mutate(PROFILE_API_KEY);
    }
  };

  return (
    <PropagationStopper className="!ml-3 inline-block align-middle">
      {isCompanyUser ? null : userId ? (
        <button
          onClick={() => {
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
    </PropagationStopper>
  );
}
