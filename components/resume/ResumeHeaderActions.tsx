"use client";

import Link from "next/link";
import { Copy, Download, Loader2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useResumeActions } from "./use-resume-actions";

/** Edit, Make a copy and Export on the resume page (RE-REQ-031). */
export default function ResumeHeaderActions({ resumeId }: { resumeId: string }) {
  const { isBusy, copy, download } = useResumeActions(resumeId);

  return (
    <>
      <Button asChild variant="outline">
        <Link href={`/resume/${resumeId}/edit`}>
          <Pencil className="h-4 w-4" />
          Edit
        </Link>
      </Button>
      <Button variant="outline" disabled={isBusy} onClick={copy}>
        <Copy className="h-4 w-4" />
        Make a copy
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" disabled={isBusy}>
            {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Export
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => download("pdf")}>Download PDF</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => download("docx")}>Download Word</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
