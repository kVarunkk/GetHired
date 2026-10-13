import BackButton from "@/components/BackButton";
import { createClient } from "@/lib/supabase/server";
import ErrorComponent from "@/components/Error";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import { Metadata } from "next";
import JobFavoriteBtn from "@/components/JobFavoriteBtn";
import { notFound, unstable_rethrow } from "next/navigation";
import { isUuid } from "@/helpers/agent/auth";

async function fetchCompanyData(company_id: string) {
  if (!isUuid(company_id)) notFound();
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  let isCompanyUser = false;

  if (user && user.id) {
    const { data: companyData } = await supabase
      .from("company_info")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (companyData) {
      isCompanyUser = true;
    }
  }

  const { data, error } = await supabase
    .from("company_info")
    .select("*, user_favorites_companies(*)")
    .eq("id", company_id)
    .maybeSingle();

  if (error) throw error;
  if (!data) notFound();

  return {
    data,
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
    const companyName = companyData.name ?? "";
    const companyDescription =
      companyData.description ||
      `Learn about ${companyName} and see their active job openings on GetHired.`;
    const description = companyDescription
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 157)
      .trimEnd();
    const canonical = `https://gethired.devhub.co.in/companies/${company_id}`;

    return {
      title: `${companyName} - Job Openings and Company Profile`,
      description,
      alternates: {
        canonical,
      },
      openGraph: {
        type: "website",
        siteName: "GetHired",
        title: `${companyName} - Job Openings`,
        description,
        url: canonical,
      },
      twitter: {
        card: "summary",
        title: `${companyName} - Job Openings`,
        description,
      },
      keywords: [
        companyName,
        "company profile",
        "job openings",
        "tech company jobs",
        "developer careers",
      ],
    };
  } catch (err) {
    unstable_rethrow(err);
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
              src={companyData.logo_url ?? undefined}
              alt="Company Logo"
              width={60}
            />

            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-1">
                <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">
                  {companyData.name}
                </h1>
                <JobFavoriteBtn
                  isCompanyUser={isCompanyUser}
                  userId={user?.id || null}
                  isFavorite={companyData.user_favorites_companies.length > 0}
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
              href={`/jobs?companyName=${encodeURIComponent(
                companyData.name ?? "",
              )}`}
            >
              <Button variant="brand">
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
                    <p className="text-xs font-medium text-muted-foreground">
                      Website
                    </p>
                    <Link
                      href={companyData.website ?? ""}
                      className="text-sm underline-offset-4 transition-colors hover:text-brand hover:underline"
                    >
                      {companyData.website || "Not specified"}
                    </Link>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">
                      Headquarters
                    </p>
                    <p className="text-sm">
                      {companyData.headquarters || "Not specified"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">
                      Industry
                    </p>
                    <p className="text-sm">
                      {companyData.industry || "Not specified"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">
                      Company Size
                    </p>
                    <p className="text-sm">
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
                <CardTitle className="text-lg">
                  About {companyData.name}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6 text-[15px] leading-7">
                {companyData.description}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  } catch (err) {
    unstable_rethrow(err);
    return <ErrorComponent />;
  }
}
