"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { downloadResumeFrom, type ResumeExportFormat } from "@/helpers/resume/download-resume";

/** The company's download of what an applicant sent (RE-REQ-062). */
export default function ApplicationResumeDownload({ applicationId }: { applicationId: string }) {
  const [isBusy, setIsBusy] = useState(false);

  const download = async (format: ResumeExportFormat) => {
    setIsBusy(true);
    const result = await downloadResumeFrom(
      `/api/company/applications/${applicationId}/resume/export?format=${format}`,
      format,
    );
    setIsBusy(false);
    if (!result.ok) toast.error(result.error);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" disabled={isBusy}>
          {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          Download
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => download("pdf")}>Download PDF</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => download("docx")}>Download Word</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
