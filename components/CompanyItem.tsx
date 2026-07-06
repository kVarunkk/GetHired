"use client";

import Link from "next/link";
import { Badge } from "./ui/badge";
import { cn } from "@/utils/utils";
import JobFavoriteBtn from "./JobFavoriteBtn";
import { Button } from "./ui/button";
import { ArrowRight } from "lucide-react";
import React from "react";
import { TCompanyInfo } from "@/utils/types";

const CompanyItem = React.memo(
  ({
    company,
    userId,
    isSuitable,
    isCompanyUser,
    isFavorite,
  }: {
    company: TCompanyInfo;
    userId: string | null;
    isSuitable: boolean;
    isCompanyUser: boolean;
    isFavorite: boolean;
  }) => {
    return (
      <div
        className={cn(
          "flex flex-col gap-3 p-4 group  rounded-lg transition hover:bg-secondary ",
        )}
      >
        <div className="flex-col sm:flex-row sm:flex items-center justify-between gap-4">
          <div className="flex flex-col gap-2 mb-6 sm:mb-0">
            <div className="flex flex-col ">
              <div className="flex items-center gap-1">
                <div className="inline-flex items-center gap-3 hover:underline underline sm:no-underline underline-offset-[4px] group-hover:underline">
                  <img
                    className="rounded-full"
                    src={company.logo_url ?? ""}
                    alt="Company Logo"
                    width={40}
                  />
                  <Link href={`/companies/${company.id}`} target="_blank">
                    <h3 className="inline text-lg sm:text-xl font-semibold">
                      {company.name}
                    </h3>
                  </Link>
                </div>
                <JobFavoriteBtn
                  isCompanyUser={isCompanyUser}
                  userId={userId}
                  company_id={company.id}
                  isFavorite={isFavorite}
                />
              </div>
              {company.tag_line && (
                <p className="text-muted-foreground"> {company.tag_line}</p>
              )}
            </div>
            <CompanyDetailBadges company={company} isSuitable={isSuitable} />
          </div>
          <Link
            href={`/companies/${company.id}`}
            target="_blank"
            className="text-start"
          >
            <Button>
              View <ArrowRight />
            </Button>
          </Link>
        </div>
      </div>
    );
  },
);

function CompanyDetailBadges({
  company,
  isSuitable,
}: {
  company: TCompanyInfo;
  isSuitable: boolean;
}) {
  const companyDetails = [
    {
      id: "location",
      value: company.headquarters,
      label: "Location",
    },
    {
      id: "industry",
      value: company.industry,
      label: "Industry",
    },
    {
      id: "size",
      value: company.company_size,
      label: "Size",
    },
  ];

  return (
    <div className="flex items-center gap-4 flex-wrap">
      {companyDetails
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

      {company.website && (
        <Link
          onClick={(e) => e.stopPropagation()}
          href={company.website}
          target="_blank"
          rel="noopener noreferrer"
          prefetch={false}
        >
          <Badge
            variant={"secondary"}
            className={cn(
              "text-xs sm:text-sm font-medium hover:!text-secondary-foreground group-hover:border-secondary-foreground hover:underline",
              "underline underline-offset-2 sm:no-underline",
            )}
          >
            {company.website}
          </Badge>
        </Link>
      )}

      {isSuitable && (
        <Badge
          className={cn(
            "text-xs sm:text-sm font-medium bg-green-200 text-green-700 !border-green-200 hover:bg-green-100 group-hover:border-secondary-foreground",
          )}
        >
          Company Match
        </Badge>
      )}
    </div>
  );
}
CompanyItem.displayName = "CompanyItem";
export default CompanyItem;
