import { notFound } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import CompanyCandidatesTable from "@/components/candidates/CompanyCandidatesTable";
import { getMyCompany } from "@/helpers/companies/get-my-company";
import { can, forbiddenMessage } from "@/helpers/companies/permissions";
import { loadCandidatesTab } from "@/helpers/candidates/candidates-tab";
import { getUserFromRequest } from "@/lib/supabase/get-user-from-request";
import { createClient } from "@/lib/supabase/server";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Candidates",
  description: "Your company's own candidates: people you added or imported.",
};

/**
 * The company's candidates (BI-REQ-003): people it added or imported, who
 * have no GetHired account. The agent has no tools for them yet, so the page
 * has no AskAgentBox.
 */
export default async function CompanyCandidatesPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | undefined }>;
}) {
  const user = await getUserFromRequest();
  if (!user) notFound();
  const supabase = await createClient();
  const company = await getMyCompany(supabase, user);
  if (!company) notFound();

  const header = (
    <PageHeader
      title="Candidates"
      description="People you added or imported. They're only visible to your company."
    />
  );

  // BI-PERM-002: the whole list is a pool read.
  if (!can(company, "talent.view")) {
    return (
      <div className="flex w-full flex-col gap-6 p-4 mb-20">
        {header}
        <p className="rounded-xl border p-6 text-sm text-muted-foreground">
          {forbiddenMessage("talent.view")}
        </p>
      </div>
    );
  }

  const candidates = await loadCandidatesTab(supabase, company, await searchParams);

  return (
    <div className="flex w-full flex-col gap-6 p-4 mb-20">
      {header}
      <CompanyCandidatesTable {...candidates} />
    </div>
  );
}
