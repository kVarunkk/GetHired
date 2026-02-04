import { createClient } from "@/lib/supabase/server";
import Error from "@/components/Error";
import BackButton from "@/components/BackButton";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import ApplicationStatusSelect from "@/components/ApplicationStatusSelector";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { IApplication } from "@/lib/types";
import ApplicationStatusBadge from "@/components/ApplicationStatusBadge";

export default async function ApplicantPage({
  params,
}: {
  params: Promise<{ applicant_id: string }>;
}) {
  try {
    const { applicant_id } = await params;
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      throw "User not authenticated.";
    }

    const { data: applicationData, error } = await supabase
      .from("applications")
      .select(
        `
        id,
        applicant_user_id,
        created_at,
        status,
        resumes(resume_path),
        answers,
        job_post_id,
        user_info(
          *
        ),
        job_postings(
          id,
          title,
          company_id,
          questions,
          description,
          job_type,
          location,
          company_info(name)
        )
      `
      )
      .eq("id", applicant_id)
      .single();

    if (error || !applicationData) {
      return <Error />;
    }

    const application = applicationData as unknown as IApplication;

    let signedUrl: string | null = null;

    const { data: signedUrlData } = await supabase.storage
      .from("resumes")
      .createSignedUrl(application?.resumes?.resume_path ?? "", 3600);

    if (signedUrlData) {
      signedUrl = signedUrlData.signedUrl;
    }

    return (
      <div className="flex flex-col w-full gap-8 p-4 mb-20">
        <div>
          <BackButton />
        </div>

        <div className="flex items-center justify-between flex-wrap gap-5">
          <h1 className="text-3xl font-medium">Applicant Details</h1>
          <ApplicationStatusSelect application={application} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Left Panel: Applicant & Job Info */}
          <div className="md:col-span-1 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>
                  {application.user_info?.full_name || "N/A"}
                </CardTitle>
                <CardDescription>
                  {application.user_info?.email}
                </CardDescription>
                {/* <div className="flex items-center gap-2"> */}

                <p className="text-sm text-muted-foreground">
                  Applied on {format(new Date(application.created_at), "PPP")}
                </p>
                <ApplicationStatusBadge status={application.status} />

                {/* </div> */}
              </CardHeader>
              <CardContent>
                <p className="font-medium">
                  Applied for:{" "}
                  <Link
                    href={`/company/job-posts/${application.job_postings?.id}`}
                    className="underline"
                  >
                    {application.job_postings?.title}
                  </Link>
                </p>
                {signedUrl && (
                  <div className="mt-4">
                    <a
                      href={signedUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Button className="w-full">View Resume</Button>
                    </a>
                  </div>
                )}
              </CardContent>
            </Card>
            <Card className="mt-4  border">
              <CardContent className="p-0">
                <Tabs defaultValue="applicant" className="w-full">
                  <TabsList className="grid w-full grid-cols-2 !rounded-b-none">
                    <TabsTrigger
                      value="applicant"
                      className="data-[state=active]:!bg-muted data-[state=active]:!shadow-none"
                    >
                      Applicant Details
                    </TabsTrigger>
                    <TabsTrigger
                      value="job"
                      className="data-[state=active]:!bg-muted data-[state=active]:!shadow-none"
                    >
                      Job Details
                    </TabsTrigger>
                  </TabsList>
                  <TabsContent value="applicant" className="p-6">
                    <div className="space-y-4">
                      <div>
                        <p className="font-semibold text-sm">Desired Roles</p>
                        <p className="text-sm text-muted-foreground">
                          {application.user_info?.desired_roles.join(", ") ||
                            "Not specified"}
                        </p>
                      </div>
                      <div>
                        <p className="font-semibold text-sm">
                          Preferred Locations
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {application.user_info?.preferred_locations.join(
                            ", "
                          ) || "Not specified"}
                        </p>
                      </div>
                      <div>
                        <p className="font-semibold text-sm">
                          Visa Sponsorship
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {application.user_info?.visa_sponsorship_required
                            ? "Required"
                            : "Not Required"}
                        </p>
                      </div>
                      <div>
                        <p className="font-semibold text-sm">
                          Short Term Career Goals
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {application.user_info?.career_goals_short_term ||
                            "Not specified"}
                        </p>
                      </div>
                      <div>
                        <p className="font-semibold text-sm">
                          Long Term Career Goals
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {application.user_info?.career_goals_long_term ||
                            "Not specified"}
                        </p>
                      </div>
                      <div>
                        <p className="font-semibold text-sm">
                          Preferred Company Size
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {application.user_info?.company_size_preference ||
                            "Not specified"}
                        </p>
                      </div>
                      <div>
                        <p className="font-semibold text-sm">
                          Preferred Work Style
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {application.user_info?.work_style_preferences?.join(
                            ", "
                          ) || "Not specified"}
                        </p>
                      </div>
                      <div>
                        <p className="font-semibold text-sm">Experience</p>
                        <p className="text-sm text-muted-foreground">
                          {application.user_info?.experience_years} Years
                        </p>
                      </div>
                      <div>
                        <p className="font-semibold text-sm">
                          Salary Expectation
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {buildSalaryRange(
                            application.user_info?.min_salary,
                            application.user_info?.max_salary,
                            application.user_info?.salary_currency
                          )}
                        </p>
                      </div>
                      <div>
                        <p className="font-semibold text-sm">Skills</p>
                        <div className="flex flex-wrap gap-2 mt-1">
                          {application.user_info?.top_skills &&
                          application.user_info?.top_skills.length > 0 ? (
                            application.user_info?.top_skills.map(
                              (skill, index) => (
                                <Badge key={index} variant="secondary">
                                  {skill}
                                </Badge>
                              )
                            )
                          ) : (
                            <span className="text-sm text-muted-foreground">
                              Not specified
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </TabsContent>
                  <TabsContent value="job" className="p-6">
                    <div className="space-y-4">
                      <div>
                        <p className="font-semibold text-sm">Title</p>
                        <p className="text-sm text-muted-foreground">
                          {application.job_postings?.title}
                        </p>
                      </div>
                      <div>
                        <p className="font-semibold text-sm">Description</p>
                        <p className="text-sm text-muted-foreground">
                          {application.job_postings?.description ||
                            "Not specified"}
                        </p>
                      </div>
                      <div>
                        <p className="font-semibold text-sm">Location</p>
                        <div className="flex flex-wrap gap-2 mt-1">
                          {application.job_postings?.location &&
                          application.job_postings?.location.length > 0 ? (
                            application.job_postings?.location.map(
                              (loc, index) => (
                                <Badge key={index} variant="secondary">
                                  {loc}
                                </Badge>
                              )
                            )
                          ) : (
                            <span className="text-sm text-muted-foreground">
                              Not specified
                            </span>
                          )}
                        </div>
                      </div>
                      <div>
                        <p className="font-semibold text-sm">Job Type</p>
                        <p className="text-sm text-muted-foreground">
                          {application.job_postings?.job_type}
                        </p>
                      </div>
                    </div>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </div>

          {/* Right Panel: Questions and Answers */}
          <div className="md:col-span-2 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Application Answers</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {application.answers && application.answers.length > 0 ? (
                  application.answers.map((answer, index) => (
                    <div key={index}>
                      <p className="font-semibold text-sm">
                        Q:{" "}
                        {application.job_postings?.questions?.[index] ||
                          `Question ${index + 1}`}
                      </p>
                      <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                        A: {answer}
                      </p>
                    </div>
                  ))
                ) : (
                  <p className="text-muted-foreground">
                    No custom questions were asked for this job.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  } catch {
    // console.error("Error in ApplicantPage:", err);
    return <Error />;
  }
}

export const buildSalaryRange = (
  min_salary?: number | "",
  max_salary?: number | "",
  salary_currency?: string
) => {
  const minSalary = min_salary || 0;
  const maxSalary = max_salary || 0;
  if (minSalary === 0 && maxSalary === 0) {
    return "Not specified";
  }
  if (minSalary === maxSalary) {
    return `${minSalary} ${salary_currency || ""}`;
  }
  if (!maxSalary) {
    return `${minSalary}${salary_currency || ""} + `;
  }
  return `${minSalary} - ${maxSalary} ${salary_currency || ""}`;
};
