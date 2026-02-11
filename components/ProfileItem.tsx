"use client";

import React, { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Dot, ArrowRight } from "lucide-react";
import { Button } from "./ui/button";
import Link from "next/link";
import { IFormData } from "@/lib/types";
import { Badge } from "./ui/badge";
import ProfileFavoriteStar from "./ProfileFavoriteStar";
import ProgressBtn from "./ProgressBtn";

const ProfileItem = React.memo(
  ({
    profile,
    isSuitable,
    companyId,
  }: {
    profile: IFormData;
    isSuitable: boolean;
    companyId?: string;
  }) => {
    return (
      <ProgressBtn
        href={`/company/profiles/${profile.user_id}`}
        className="text-start"
      >
        <div
          className={cn(
            "flex flex-col gap-3 p-4 group rounded-lg transition  hover:bg-secondary",
          )}
        >
          <div className="flex-col sm:flex-row sm:flex items-center justify-between gap-4">
            <div className="flex flex-col gap-2 mb-6 sm:mb-0">
              <div className="flex items-center flex-wrap">
                <h3 className="text-lg sm:text-xl font-semibold">
                  {profile.full_name || "N/A"}
                </h3>
                <Dot />
                <p className="text-muted-foreground text-wrap">
                  {profile?.desired_roles?.[0] || ""}
                </p>

                <ProfileFavoriteStar profile={profile} companyId={companyId} />
              </div>
              <ProfileDetailBadges profile={profile} isSuitable={isSuitable} />
            </div>

            <div className="flex items-center gap-2">
              <Link href={`/company/profiles/${profile.user_id}`}>
                <Button>
                  View Profile
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </ProgressBtn>
    );
  },
);

function ProfileDetailBadges({
  profile,
  isSuitable,
}: {
  profile: IFormData;
  isSuitable: boolean;
}) {
  const [jobDetails, setJobDetails] = useState<
    {
      id: string;
      value: string;
      label: string;
    }[]
  >([]);

  useEffect(() => {
    const buildSalaryRange = () => {
      const minSalary = profile?.min_salary || 0;
      const maxSalary = profile?.max_salary || 0;
      if (minSalary === 0 && maxSalary === 0) {
        return "Not specified";
      }
      if (minSalary === maxSalary) {
        return `${minSalary} ${profile?.salary_currency || ""}`;
      }
      if (!maxSalary) {
        return `${minSalary}${profile?.salary_currency || ""} + `;
      }
      return `${minSalary} - ${maxSalary} ${profile?.salary_currency || ""}`;
    };

    if (profile) {
      setJobDetails(() => [
        {
          id: "experience",
          value: `${profile.experience_years} Years`,
          label: "Experience Years",
        },
        {
          id: "salary_range",
          value: buildSalaryRange(),
          label: "Salary Range",
        },
        {
          id: "skills",
          value: profile.top_skills.join(", "),
          label: "Skills",
        },
        {
          id: "locations",
          value: profile.preferred_locations.join(", "),
          label: "Locations",
        },
        {
          id: "job_type",
          value: profile.job_type.join(", "),
          label: "Job Type",
        },
      ]);
    }
  }, [profile]);

  return (
    <div className="flex items-center gap-4 flex-wrap">
      {jobDetails
        .filter((each) => each.value)
        .map((detail) => (
          <Badge
            variant={"outline"}
            key={detail.id}
            className={cn(
              "text-xs sm:text-sm font-medium group-hover:border-secondary-foreground",
            )}
          >
            {detail.value}
          </Badge>
        ))}

      {isSuitable && (
        <Badge
          className={cn(
            "text-xs sm:text-sm font-medium bg-green-200 text-green-700 !border-green-200 hover:bg-green-100 group-hover:border-secondary-foreground",
          )}
        >
          Profile Match
        </Badge>
      )}
    </div>
  );
}

export default ProfileItem;
