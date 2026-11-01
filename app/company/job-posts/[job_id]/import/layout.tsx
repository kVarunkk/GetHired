import type { ReactNode } from "react";
import SectionHeader from "@/components/SectionHeader";
import ImportMethodTabs from "@/components/candidates/ImportMethodTabs";
import { requireJobImport } from "@/helpers/candidates/import-section";

/**
 * A job's Import candidates section (CP-REQ-020/021): resumes, a spreadsheet
 * or one person, each its own tab and route. For applicants.import on the
 * job, else a 404. No bottom padding: the confirm bars stick to the bottom
 * edge.
 */
export default async function JobImportLayout({
  params,
  children,
}: {
  params: Promise<{ job_id: string }>;
  children: ReactNode;
}) {
  const { job_id } = await params;
  await requireJobImport(job_id);
  return (
    <div className="flex w-full flex-col gap-6">
      <SectionHeader
        title="Import candidates"
        description="Add people who applied outside GetHired. No one is emailed."
      />
      <ImportMethodTabs jobId={job_id} />
      {children}
    </div>
  );
}
