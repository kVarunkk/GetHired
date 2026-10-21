import { notFound, unstable_rethrow } from "next/navigation";
import { after } from "next/server";
import { format } from "date-fns";
import ApplicationStatusBadge from "@/components/ApplicationStatusBadge";
import CandidateSharedSection from "@/components/CandidateSharedSection";
import Error from "@/components/Error";
import SectionHeader from "@/components/SectionHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { loadApplicationFrame } from "@/helpers/applications/application-page";
import { loadSharedSignals, markSharedSignalsViewed } from "@/helpers/applications/shared-signals";
import { RECRUITER_CANDIDATE_COLUMNS } from "@/helpers/profiles/candidate-columns";
import type { TApplicationStatus } from "@/utils/types";
import { buildSalaryRange } from "@/utils/buildSalaryRange";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Candidate",
};

/** An application's Candidate section: who applied, their resume and what they shared. */
export default async function ApplicationCandidatePage({ params }: { params: Promise<{ application_id: string }> }) {
  try {
    const { application_id } = await params;
    const frame = await loadApplicationFrame(application_id);
    if (!frame) notFound();
    const { supabase } = frame;

    const { data: application, error } = await supabase
      .from("applications")
      .select(`id, created_at, status, resumes(resume_path), user_info(${RECRUITER_CANDIDATE_COLUMNS})` as const)
      .eq("id", application_id)
      .maybeSingle();
    if (error) throw error;
    if (!application) notFound();
    const candidate = application.user_info;

    // What the candidate shared (OR-REQ-032). A failure hides the section,
    // not the page. Opening it ends the candidate's right to un-share.
    const [shared, { data: signedUrlData }] = await Promise.all([
      loadSharedSignals(supabase, application.id).catch((err) => {
        console.error("[application] couldn't load shared items", err);
        return null;
      }),
      supabase.storage.from("resumes").createSignedUrl(application.resumes?.resume_path ?? "", 3600),
    ]);
    if (shared?.unviewedIds.length) {
      const ids = shared.unviewedIds;
      after(() => markSharedSignalsViewed(application.id, ids));
    }
    const signedUrl = signedUrlData?.signedUrl ?? null;

    const details: { label: string; value: string }[] = [
      { label: "Desired Roles", value: candidate?.desired_roles?.join(", ") || "Not specified" },
      { label: "Preferred Locations", value: candidate?.preferred_locations?.join(", ") || "Not specified" },
      { label: "Visa Sponsorship", value: candidate?.visa_sponsorship_required ? "Required" : "Not Required" },
      { label: "Short Term Career Goals", value: candidate?.career_goals_short_term || "Not specified" },
      { label: "Long Term Career Goals", value: candidate?.career_goals_long_term || "Not specified" },
      { label: "Preferred Company Size", value: candidate?.company_size_preference || "Not specified" },
      { label: "Preferred Work Style", value: candidate?.work_style_preferences?.join(", ") || "Not specified" },
      { label: "Experience", value: `${candidate?.experience_years} Years` },
      {
        label: "Salary Expectation",
        value: buildSalaryRange(candidate?.min_salary, candidate?.max_salary, candidate?.salary_currency),
      },
    ];

    // Emails and URLs have no spaces to wrap at, so they may break anywhere.
    return (
      <div className="mb-20 flex flex-col gap-6 [overflow-wrap:anywhere]">
        <SectionHeader title="Candidate" />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Card className="h-fit">
            <CardHeader>
              <CardTitle>{candidate?.full_name || "N/A"}</CardTitle>
              <CardDescription>{candidate?.email}</CardDescription>
              <p className="text-sm text-muted-foreground">
                Applied on {format(new Date(application.created_at), "PPP")}
              </p>
              <ApplicationStatusBadge status={application.status as TApplicationStatus} />
            </CardHeader>
            {signedUrl && (
              <CardContent>
                <Button asChild className="w-full">
                  <a href={signedUrl} target="_blank" rel="noopener noreferrer">
                    View Resume
                  </a>
                </Button>
              </CardContent>
            )}
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Profile</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              {details.map((detail) => (
                <div key={detail.label}>
                  <p className="text-sm font-semibold">{detail.label}</p>
                  <p className="text-sm text-muted-foreground">{detail.value}</p>
                </div>
              ))}
              <div className="sm:col-span-2">
                <p className="text-sm font-semibold">Skills</p>
                <div className="mt-1 flex flex-wrap gap-2">
                  {candidate?.top_skills && candidate.top_skills.length > 0 ? (
                    candidate.top_skills.map((skill, index) => (
                      <Badge key={index} variant="secondary">
                        {skill}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-sm text-muted-foreground">Not specified</span>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {shared && <CandidateSharedSection interview={shared.interview} review={shared.review} />}
      </div>
    );
  } catch (err) {
    unstable_rethrow(err);
    return <Error />;
  }
}
