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
import StagePicker from "@/components/pipeline/StagePicker";
import NotesPanel from "@/components/pipeline/NotesPanel";
import ActivityTimeline from "@/components/pipeline/ActivityTimeline";
import { getMyCompany } from "@/helpers/companies/get-my-company";
import { listNotes } from "@/helpers/pipeline/notes";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import ApplicationStatusBadge from "@/components/ApplicationStatusBadge";
import { TApplicationStatus } from "@/utils/types";
import { buildSalaryRange } from "@/utils/buildSalaryRange";
import { notFound, unstable_rethrow } from "next/navigation";
import { after } from "next/server";
import CandidateSharedSection from "@/components/CandidateSharedSection";
import {
  loadSharedSignals,
  markSharedSignalsViewed,
} from "@/helpers/applications/shared-signals";
import { isUuid } from "@/helpers/agent/auth";
import { RECRUITER_CANDIDATE_COLUMNS } from "@/helpers/profiles/candidate-columns";
import ScreeningCard from "@/components/matching/ScreeningCard";
import {
  SCREENING_VIEW_COLUMNS,
  toScreeningView,
} from "@/helpers/matching/screening-view";

export default async function ApplicantPage({
  params,
}: {
  params: Promise<{ applicant_id: string }>;
}) {
  try {
    const { applicant_id } = await params;
    if (!isUuid(applicant_id)) notFound();
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      throw "User not authenticated.";
    }

    const { data: application, error } = await supabase
      .from("applications")
      .select(
        `
        id,
        applicant_user_id,
        created_at,
        status,
        stage_id,
        resumes(resume_path),
        answers,
        job_post_id,
        user_info(${RECRUITER_CANDIDATE_COLUMNS}),
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
      ` as const,
      )
      .eq("id", applicant_id)
      .maybeSingle();

    if (error) throw error;
    if (!application) notFound();

    // RLS: only the job's company members can read it (MT-SEC-004).
    const { data: screeningRow } = application.job_post_id
      ? await supabase
          .from("application_screenings")
          .select(SCREENING_VIEW_COLUMNS)
          .eq("application_id", application.id)
          .maybeSingle()
      : { data: null };
    const screening = screeningRow ? toScreeningView(screeningRow) : null;

    // RLS: only the company's members can read its stages, notes and events.
    // Archived stages are kept for the timeline's names.
    const companyId = application.job_postings?.company_id;
    const { data: allStages } = companyId
      ? await supabase
          .from("pipeline_stages")
          .select("id, name, kind, archived")
          .eq("company_id", companyId)
          .order("position", { ascending: true })
      : { data: null };
    const stages = allStages?.filter((s) => !s.archived) ?? null;

    const company = await getMyCompany(supabase, user);
    const [notes, { data: events }] = await Promise.all([
      company
        ? listNotes({ supabase, company }, { applicationId: application.id })
        : [],
      supabase
        .from("application_events")
        .select("*")
        .eq("application_id", application.id)
        .order("created_at", { ascending: false })
        .limit(200),
    ]);

    // What the candidate shared (OR-REQ-032). A failure hides the section,
    // not the page. Opening the page ends the candidate's right to un-share.
    const shared = await loadSharedSignals(supabase, application.id).catch(
      (err) => {
        console.error("[applicant] couldn't load shared items", err);
        return null;
      },
    );
    if (shared?.unviewedIds.length) {
      const ids = shared.unviewedIds;
      after(() => markSharedSignalsViewed(application.id, ids));
    }

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
          {stages && stages.length > 0 && (
            <StagePicker
              applicationId={application.id}
              stages={stages}
              currentStageId={application.stage_id}
            />
          )}
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
                <ApplicationStatusBadge
                  status={application.status as TApplicationStatus}
                />

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
                          {application.user_info?.desired_roles?.join(", ") ||
                            "Not specified"}
                        </p>
                      </div>
                      <div>
                        <p className="font-semibold text-sm">
                          Preferred Locations
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {application.user_info?.preferred_locations?.join(
                            ", ",
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
                            ", ",
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
                            application.user_info?.salary_currency,
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
                              ),
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
                              ),
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

          {/* Right Panel: Overview (screening, answers), Notes, Activity */}
          <Tabs defaultValue="overview" className="md:col-span-2">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="notes">Notes ({notes.length})</TabsTrigger>
              <TabsTrigger value="activity">Activity</TabsTrigger>
            </TabsList>
            <TabsContent value="notes" className="mt-4">
              <NotesPanel
                applicationId={application.id}
                notes={notes}
                currentUserId={user.id}
              />
            </TabsContent>
            <TabsContent value="activity" className="mt-4">
              <ActivityTimeline
                events={events ?? []}
                stages={allStages ?? []}
              />
            </TabsContent>
            <TabsContent value="overview" className="mt-4 space-y-4">
              {application.job_post_id && (
                <ScreeningCard
                  applicationId={application.id}
                  jobPostId={application.job_post_id}
                  questions={application.job_postings?.questions ?? []}
                  screening={screening}
                />
              )}
              {shared && (
                <CandidateSharedSection
                  interview={shared.interview}
                  review={shared.review}
                />
              )}
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
            </TabsContent>
          </Tabs>
        </div>
      </div>
    );
  } catch (err) {
    unstable_rethrow(err);
    return <Error />;
  }
}
