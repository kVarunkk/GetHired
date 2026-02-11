"use client";

import Link from "next/link";
// import { Link as ModifiedLink } from "react-transition-progress/next";
import { Badge } from "./ui/badge";
import { ICompanyInfo } from "@/lib/types";
import { User } from "@supabase/supabase-js";
import { cn } from "@/lib/utils";
import JobFavoriteBtn from "./JobFavoriteBtn";
// import ProgressBtn from "./ProgressBtn";
import { Button } from "./ui/button";
import { ArrowRight } from "lucide-react";
import ModifiedLink from "./ModifiedLink";
import React from "react";

const CompanyItem = React.memo(
  ({
    company,
    user,
    isSuitable,
    isCompanyUser,
  }: {
    company: ICompanyInfo;
    user: User | null;
    isSuitable: boolean;
    isCompanyUser: boolean;
  }) => {
    // console.log(company.user_favorites_companies);
    return (
      <>
        <ModifiedLink
          href={`/companies/${company.id}`}
          target="_blank"
          className="text-start"
        >
          <div
            className={cn(
              "flex flex-col gap-3 p-4 group  rounded-lg transition hover:bg-secondary ",
            )}
          >
            <div className="flex-col sm:flex-row sm:flex items-center justify-between gap-4">
              <div className="flex flex-col gap-2 mb-6 sm:mb-0">
                <div className="flex flex-col ">
                  <div className="flex items-center gap-1">
                    <div
                      // href={`/companies/${company.id}`}
                      className="inline-flex items-center gap-3 hover:underline underline sm:no-underline underline-offset-2"
                      // onClick={(e) => e.stopPropagation()}
                    >
                      <img
                        className="rounded-full"
                        src={company.logo_url}
                        alt="Company Logo"
                        width={40}
                      />
                      <h3 className="inline text-lg sm:text-xl font-semibold">
                        {company.name}
                      </h3>
                    </div>
                    <JobFavoriteBtn
                      isCompanyUser={isCompanyUser}
                      user={user}
                      userFavoritesCompanyInfo={
                        company.user_favorites_companies
                      }
                      company_id={company.id}
                    />
                  </div>
                  {company.tag_line && (
                    <p className="text-muted-foreground"> {company.tag_line}</p>
                  )}
                </div>
                <CompanyDetailBadges
                  company={company}
                  isSuitable={isSuitable}
                />
              </div>
              <ModifiedLink
                href={`/companies/${company.id}`}
                target="_blank"
                className="text-start"
              >
                <Button>
                  View <ArrowRight />
                </Button>
              </ModifiedLink>
            </div>
          </div>
        </ModifiedLink>
      </>
    );
  },
);

function CompanyDetailBadges({
  company,
  isSuitable,
}: {
  company: ICompanyInfo;
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
