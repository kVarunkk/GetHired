import type { ReactNode } from "react";
import PageHeader from "@/components/PageHeader";
import ImportMethodTabs from "@/components/candidates/ImportMethodTabs";
import { CANDIDATES_LIST_PATH } from "@/helpers/candidates/paths";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Import candidates",
};

/**
 * The Candidates page's import (CP-REQ-031): resumes or a spreadsheet, each
 * its own tab and route, into your candidates, a talent list or a job. Each
 * page checks the member can import. No bottom padding: the confirm bars
 * stick to the bottom edge.
 */
export default function ImportCandidatesLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-6 p-4 pb-0">
      <PageHeader
        title="Import candidates"
        description="Bring people over from their resumes, a spreadsheet or another ATS's export. No one is emailed."
        backHref={CANDIDATES_LIST_PATH}
      />
      <ImportMethodTabs />
      {children}
    </div>
  );
}
