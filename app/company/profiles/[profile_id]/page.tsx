import { createClient } from "@/lib/supabase/server";
import ErrorComponent from "@/components/Error";
import BackButton from "@/components/BackButton";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { IApplication, IFormData } from "@/lib/types";
import ProfileFavoriteStar from "@/components/ProfileFavoriteStar";
import { buildSalaryRange } from "../../applicants/[applicant_id]/page";
import ProfileActiveApplication from "@/components/ProfileActiveApplications";
import SelectProfile from "@/components/SelectProfile";
import { Mail } from "lucide-react";
import Link from "next/link";
import { GitHubLogoIcon, LinkedInLogoIcon } from "@radix-ui/react-icons";

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ profile_id: string }>;
}) {
  try {
    const { profile_id } = await params;
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      throw new Error("User not authenticated.");
    }

    // Fetch the company ID of the logged-in user
    const { data: companyData, error: companyError } = await supabase
      .from("company_info")
      .select("*, job_postings(id, title, job_id)")
      .eq("user_id", user.id)
      .single();

    if (companyError || !companyData) {
      throw new Error("Logged-in user does not have a company profile.");
    }

    // Fetch the applicant's profile details
    const { data: applicantProfileData, error } = await supabase
      .from("user_info")
      .select(
        `
        *,
        resumes(resume_path),
        company_favorites (
          company_id
        ),
        applications (
          id,
          status,
          created_at,
          job_postings!inner (
            id,
            title,
            company_id
          )
        )
      `
      )
      .eq("user_id", profile_id)
      .eq("resumes.is_primary", true)
      .eq("applications.job_postings.company_id", companyData.id)
      .single();

    if (error || !applicantProfileData) {
      // console.error("Error fetching applicant data:", error);
      return <ErrorComponent />;
    }

    const applicantProfile = applicantProfileData as IFormData;

    // Generate a signed URL for the resume from the private bucket
    const { data: signedUrlData } = await supabase.storage
      .from("resumes")
      .createSignedUrl(applicantProfile.resumes?.[0]?.resume_path || "", 3600);

    // if (signedUrlError) {
    //   // console.error("Error creating signed URL:", signedUrlError);
    //   return <ErrorComponent />;
    // }

    const signedUrl = signedUrlData?.signedUrl;

    return (
      <div className="flex flex-col w-full p-4 gap-8 ">
        <div className="flex items-center justify-between">
          <BackButton />
        </div>

        <div className="flex items-center justify-between flex-wrap gap-5">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-1">
              <h1 className="text-3xl font-medium">
                {applicantProfile.full_name}
              </h1>
              <ProfileFavoriteStar
                profile={applicantProfile}
                companyId={companyData.id}
              />
            </div>
            {/* <p className="text-muted-foreground">{applicantProfile.email}</p> */}
            <div className="flex items-center gap-2">
              <Link
                href={`mailto:${applicantProfile.email}`}
                className=" text-muted-foreground hover:text-primary transition-colors"
              >
                <Mail className="h-6 w-6" />
              </Link>
              {applicantProfile.linkedin_url && (
                <Link
                  target="_blank"
                  href={applicantProfile.linkedin_url}
                  className=" text-muted-foreground hover:text-primary transition-colors"
                >
                  <LinkedInLogoIcon className="h-6 w-6" />
                </Link>
              )}
              {applicantProfile.github_url && (
                <Link
                  target="_blank"
                  href={applicantProfile.github_url}
                  className=" text-muted-foreground hover:text-primary transition-colors"
                >
                  <GitHubLogoIcon className="h-6 w-6" />
                </Link>
              )}
            </div>
          </div>
          <div className="flex items-center gap-5">
            <SelectProfile
              // userApplications={applicantProfile.applications}
              jobPostings={companyData.job_postings}
              companyId={companyData.id}
              // applicantUserId={applicantProfile.user_id}
              // resumeUrl={applicantProfile.resume_url}
              applicantProfile={applicantProfile}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Left Panel: Applicant Info Card */}
          <div className="md:col-span-1 space-y-4">
            <Card>
              <CardContent>
                <div className="space-y-4 pt-5">
                  {signedUrl && (
                    <a
                      href={signedUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Button className="w-full">View Resume</Button>
                    </a>
                  )}
                  <div>
                    <p className="font-semibold text-sm">Desired Roles</p>
                    <p className="text-sm text-muted-foreground">
                      {applicantProfile.desired_roles.join(", ") ||
                        "Not specified"}
                    </p>
                  </div>
                  <div>
                    <p className="font-semibold text-sm">Preferred Locations</p>
                    <p className="text-sm text-muted-foreground">
                      {applicantProfile.preferred_locations.join(", ") ||
                        "Not specified"}
                    </p>
                  </div>
                  <div>
                    <p className="font-semibold text-sm">Visa Sponsorship</p>
                    <p className="text-sm text-muted-foreground">
                      {applicantProfile.visa_sponsorship_required
                        ? "Required"
                        : "Not Required"}
                    </p>
                  </div>
                  <div>
                    <p className="font-semibold text-sm">
                      Short Term Career Goals
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {applicantProfile.career_goals_short_term ||
                        "Not specified"}
                    </p>
                  </div>
                  <div>
                    <p className="font-semibold text-sm">
                      Long Term Career Goals
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {applicantProfile.career_goals_long_term ||
                        "Not specified"}
                    </p>
                  </div>
                  <div>
                    <p className="font-semibold text-sm">
                      Preferred Company Size
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {applicantProfile.company_size_preference ||
                        "Not specified"}
                    </p>
                  </div>
                  <div>
                    <p className="font-semibold text-sm">
                      Preferred Work Style
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {applicantProfile.work_style_preferences?.join(", ") ||
                        "Not specified"}
                    </p>
                  </div>
                  <div>
                    <p className="font-semibold text-sm">Experience</p>
                    <p className="text-sm text-muted-foreground">
                      {applicantProfile.experience_years} Years
                    </p>
                  </div>
                  <div>
                    <p className="font-semibold text-sm">Salary Expectation</p>
                    <p className="text-sm text-muted-foreground">
                      {buildSalaryRange(
                        applicantProfile.min_salary,
                        applicantProfile.max_salary,
                        applicantProfile.salary_currency
                      )}
                    </p>
                  </div>
                  <div>
                    <p className="font-semibold text-sm">Skills</p>
                    <div className="flex flex-wrap gap-2 mt-1">
                      {applicantProfile.top_skills &&
                      applicantProfile.top_skills.length > 0 ? (
                        applicantProfile.top_skills.map((skill, index) => (
                          <Badge key={index} variant="secondary">
                            {skill}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-sm text-muted-foreground">
                          Not specified
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Right Panel: Job and Application History */}
          <div className="md:col-span-2 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Application History</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {applicantProfile.applications &&
                applicantProfile.applications.length > 0 ? (
                  applicantProfile.applications.map((app: IApplication) => (
                    <ProfileActiveApplication key={app.id} app={app} />
                  ))
                ) : (
                  <p className="text-muted-foreground w-full text-center text-sm">
                    No application history found.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  } catch (err) {
    console.error("Error in ApplicantPage:", err);
    return <ErrorComponent />;
  }
}
