import type { Metadata } from "next";
import { redirect } from "next/navigation";
import AddJobForm from "@/components/tracker/AddJobForm";
import PageHeader from "@/components/PageHeader";
import { createClient } from "@/lib/supabase/server";
import { myJobsPath } from "@/helpers/tracker/paths";

export const metadata: Metadata = {
  title: "Add job",
  robots: { index: false, follow: false },
};

export default async function AddJobPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const defaultStatus = params.status === "saved" ? "saved" : "applied";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { data: resumes } = await supabase
    .from("resumes")
    .select("id, name")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  return (
    <div className="flex flex-col gap-6 p-4">
      <PageHeader
        title="Add job"
        description="Keep a job you saved, or one you applied to anywhere, in My Jobs."
        backHref={myJobsPath({ tab: defaultStatus === "saved" ? "saved" : "applications" })}
        backLabel="Back to My Jobs"
      />
      <AddJobForm defaultStatus={defaultStatus} resumes={resumes ?? []} />
    </div>
  );
}
