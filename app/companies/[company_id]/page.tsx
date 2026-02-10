import BackButton from "@/components/BackButton";
import { createClient } from "@/lib/supabase/server";
import ErrorComponent from "@/components/Error";
import { ICompanyInfo } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import { Metadata } from "next";
import JobFavoriteBtn from "@/components/JobFavoriteBtn";

async function fetchCompanyData(company_id: string) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  let isCompanyUser = false;

  const { data: companyData } = await supabase
    .from("company_info")
    .select("id")
    .eq("user_id", user?.id)
    .single();

  const { data, error } = await supabase
    .from("company_info")
    .select("*, user_favorites_companies(*)")
    .eq("id", company_id)
    .single();

  if (error) throw error;

  if (companyData) {
    isCompanyUser = true;
  }
  return {
    data: data as ICompanyInfo,
    user,
    isCompanyUser,
  };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ company_id: string }>;
}): Promise<Metadata> {
  try {
    const { company_id } = await params;
    const { data: companyData } = await fetchCompanyData(company_id);
    const companyName = companyData.name;
    const companyDescription =
      companyData.description ||
      `Learn about ${companyName} and see their active job openings on GetHired.`;

    return {
      title: `${companyName} - Job Openings and Company Profile | GetHired`,
      description: companyDescription.substring(0, 160),
      keywords: [
        companyName,
        "company profile",
        "job openings",
        "tech company jobs",
        "developer careers",
      ],
    };
  } catch {
    return {
      title: "Company Profile | GetHired",
      description: "View profiles of companies hiring top tech talent.",
    };
  }
}

export default async function CompanyIdPage({
  params,
}: {
  params: Promise<{ company_id: string }>;
}) {
  try {
    const { company_id } = await params;
    const {
      data: companyData,
      user,
      isCompanyUser,
    } = await fetchCompanyData(company_id);

    return (
      <div className="flex flex-col w-full gap-8 p-4">
        <div className="flex items-center justify-between">
          <BackButton />
        </div>

        <div className="flex items-center justify-between flex-wrap gap-5">
          <div className="flex items-center gap-3">
            <img
              className="rounded-lg"
              src={companyData.logo_url}
              alt="Company Logo"
              width={60}
            />

            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-1">
                <h1 className="text-3xl font-medium">{companyData.name}</h1>
                <JobFavoriteBtn
                  isCompanyUser={isCompanyUser}
                  user={user}
                  userFavoritesCompanyInfo={
                    companyData.user_favorites_companies
                  }
                  company_id={company_id}
                />
              </div>
              <p className="text-muted-foreground">{companyData.tag_line}</p>
            </div>
          </div>

          <div className="flex items-center gap-5">
            <Link
              target="_blank"
              rel="noopener noreferrer"
              href={`/jobs?companyName=${encodeURIComponent(companyData.name)}`}
            >
              <Button>
                See Active Jobs <ArrowRight />
              </Button>
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="md:col-span-1 space-y-4">
            <Card>
              <CardContent>
                <div className="space-y-4 pt-5">
                  <div>
                    <p className="font-semibold text-sm">Website</p>
                    <Link
                      href={companyData.website}
                      className="text-sm  text-blue-600"
                    >
                      {companyData.website || "Not specified"}
                    </Link>
                  </div>
                  <div>
                    <p className="font-semibold text-sm">Headquarters</p>
                    <p className="text-sm text-muted-foreground">
                      {companyData.headquarters || "Not specified"}
                    </p>
                  </div>
                  <div>
                    <p className="font-semibold text-sm">Industry</p>
                    <p className="text-sm text-muted-foreground">
                      {companyData.industry || "Not specified"}
                    </p>
                  </div>
                  <div>
                    <p className="font-semibold text-sm">Company Size</p>
                    <p className="text-sm text-muted-foreground">
                      {companyData.company_size || "Not specified"}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Right Panel: Job and Application History */}
          <div className="md:col-span-2 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-xl">
                  About {companyData.name}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {companyData.description}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  } catch {
    return <ErrorComponent />;
  }
}
