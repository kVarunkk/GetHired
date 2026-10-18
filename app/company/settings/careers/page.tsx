import { notFound, unstable_rethrow } from "next/navigation";
import CareersEditor from "@/components/careers/CareersEditor";
import Error from "@/components/Error";
import PageHeader from "@/components/PageHeader";
import { getMyCareersPreview } from "@/helpers/careers/get-careers-page";
import { parseCareersFilters, searchCompanyJobs, toSearchView } from "@/helpers/careers/search-company-jobs";
import { getMyCompany } from "@/helpers/companies/get-my-company";
import { can, forbiddenMessage } from "@/helpers/companies/permissions";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * CP-REQ-012: the careers page editor. Everyone on the team can see it and the
 * preview; careers.edit changes it (the actions and RPCs check again).
 */
export default async function CareersSettingsPage() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) notFound();
    const company = await getMyCompany(supabase, user);
    if (!company) notFound();

    const preview = await getMyCareersPreview(supabase);
    if (!preview) notFound();
    const jobs = toSearchView(searchCompanyJobs(preview.jobs, parseCareersFilters(new URLSearchParams())));

    return (
      <div className="mb-20 flex w-full flex-col gap-6 p-4">
        <PageHeader
          backHref="/company/settings"
          backLabel="Back to settings"
          title="Careers page"
          description="A branded page with all your open roles, at your own address on GetHired."
        />
        <CareersEditor
          initial={preview.page}
          jobs={jobs}
          canEdit={can(company, "careers.edit")}
          forbidden={forbiddenMessage("careers.edit")}
        />
      </div>
    );
  } catch (err) {
    unstable_rethrow(err);
    return <Error />;
  }
}
