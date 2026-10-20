"use client";

import React, { useMemo, useState } from "react";
import { cn } from "@/utils/utils";
import { Dot, ArrowRight } from "lucide-react";
import { Button } from "./ui/button";
import Link from "next/link";
import { Badge } from "./ui/badge";
import ProfileFavoriteStar from "./ProfileFavoriteStar";
import { AllProfileWithRelations } from "@/utils/types";
import { buildSalaryRange } from "@/utils/buildSalaryRange";
import MatchScoreBadge from "./matching/MatchScoreBadge";
import MatchExplanationCard from "./matching/MatchExplanationCard";
import AddToListMenu from "./pipeline/AddToListMenu";
import OutreachStatusBadge from "./outreach/OutreachStatusBadge";
import OutreachComposer from "./outreach/OutreachComposer";

/** The explanation's one-line summary, if the stored JSON has one. */
function summaryOf(explanation: unknown): string | null {
  if (!explanation || typeof explanation !== "object") return null;
  const summary = (explanation as { summary?: unknown }).summary;
  return typeof summary === "string" && summary.trim() ? summary : null;
}

const ProfileItem = React.memo(
  ({
    profile,
    isSuitable,
    companyId,
    isFavorite,
    jobPostId,
  }: {
    profile: AllProfileWithRelations;
    isSuitable: boolean;
    companyId?: string;
    isFavorite: boolean;
    /** Set in job context (`?job_post=`): shows the match score and summary. */
    jobPostId?: string | null;
  }) => {
    const [reachingOut, setReachingOut] = useState(false);
    const [outreachStatus, setOutreachStatus] = useState(profile.outreach_status ?? null);
    const match = jobPostId ? profile.job_relevant_profiles?.[0] : undefined;
    // A stale explanation describes an older version of the job.
    const summary =
      match?.explanation_status === "completed" ? summaryOf(match.explanation) : null;
    const profileHref = `/company/profiles/${profile.user_id}${
      jobPostId ? `?job_post=${encodeURIComponent(jobPostId)}` : ""
    }`;

    return (
      <div
        className={cn(
          "flex flex-col gap-3 p-4 group rounded-lg transition-colors hover:bg-muted/60",
        )}
      >
        <div className="flex-col sm:flex-row sm:flex items-center justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-2 mb-6 sm:mb-0">
            <div className="flex items-center flex-wrap">
              <Link
                href={profileHref}
                target="_blank"
                className="inline hover:underline group-hover:underline underline sm:no-underline underline-offset-[4px]"
                prefetch={false}
              >
                <h3 className="text-lg sm:text-xl font-semibold">
                  {profile.full_name || "N/A"}
                </h3>
              </Link>

              <Dot />
              <p className="text-muted-foreground text-wrap">
                {profile?.desired_roles?.[0] || ""}
              </p>

              <ProfileFavoriteStar
                profileId={profile.user_id}
                companyId={companyId}
                isFavorite={isFavorite}
              />

              <MatchScoreBadge
                score={match?.match_score}
                className="ml-2 text-xs sm:text-sm"
              />
              <OutreachStatusBadge status={outreachStatus} className="ml-2" />
            </div>
            {summary && (
              <p className="text-sm text-muted-foreground">{summary}</p>
            )}
            <ProfileDetailBadges profile={profile} isSuitable={isSuitable} />
            {jobPostId && match && match.explanation_status !== "completed" && (
              <MatchExplanationCard
                compact
                jobPostId={jobPostId}
                candidateId={profile.user_id}
                explanation={null}
              />
            )}
          </div>

          {/* Below sm the buttons share the row and wrap rather than overflow. */}
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:flex-nowrap sm:shrink-0">
            {companyId && (
              <AddToListMenu
                candidateUserId={profile.user_id}
                onReachOut={() => setReachingOut(true)}
                className="grow sm:flex-none"
              />
            )}
            <Button asChild className="grow sm:flex-none">
              <Link href={profileHref} prefetch={false} target="_blank">
                View Profile
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
        {companyId && (
          <OutreachComposer
            candidateId={profile.user_id}
            candidateName={profile.full_name}
            open={reachingOut}
            onOpenChange={setReachingOut}
            defaultJobPostId={jobPostId}
            onSent={(outreach) => setOutreachStatus(outreach.status as typeof outreachStatus)}
          />
        )}
      </div>
    );
  },
);

function ProfileDetailBadges({
  profile,
  isSuitable,
}: {
  profile: AllProfileWithRelations;
  isSuitable: boolean;
}) {
  const jobDetails = useMemo(() => {
    return [
      {
        id: "experience",
        value: profile.experience_years
          ? `${profile.experience_years} Years`
          : "",
        label: "Experience Years",
      },
      {
        id: "salary_range",
        value: buildSalaryRange(
          profile?.min_salary,
          profile?.max_salary,
          profile?.salary_currency,
        ),
        label: "Salary Range",
      },
      {
        id: "skills",
        value: profile.top_skills?.join(", "),
        label: "Skills",
      },
      {
        id: "locations",
        value: profile.preferred_locations?.join(", "),
        label: "Locations",
      },
      {
        id: "job_type",
        value: profile.job_type.join(", "),
        label: "Job Type",
      },
    ];
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
        <Badge variant="success" className="text-xs sm:text-sm font-medium">
          Profile Match
        </Badge>
      )}
    </div>
  );
}
ProfileItem.displayName = "ProfileItem";
export default ProfileItem;
