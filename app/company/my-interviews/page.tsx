import { notFound, unstable_rethrow } from "next/navigation";
import type { Metadata } from "next";
import Error from "@/components/Error";
import PageHeader from "@/components/PageHeader";
import MyInterviewsTable from "@/components/interviews/MyInterviewsTable";
import { getMyCompany } from "@/helpers/companies/get-my-company";
import { listMyInterviews } from "@/helpers/interviews/my-interviews";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "My interviews",
};

/**
 * IVT-021: the interviews the session member is on, for every member (a role
 * with no permissions included). `list_my_interviews` returns only their own
 * panel seats.
 */
export default async function MyInterviewsPage() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const company = user ? await getMyCompany(supabase, user) : null;
    if (!company) notFound();

    const interviews = await listMyInterviews(supabase);

    return (
      <div className="mb-20 flex w-full flex-col gap-6 p-4">
        <PageHeader
          title="My interviews"
          description="Interviews you're on. Open the kit to prepare and to write your scorecard."
        />
        <MyInterviewsTable interviews={interviews} />
      </div>
    );
  } catch (err) {
    unstable_rethrow(err);
    return <Error />;
  }
}
