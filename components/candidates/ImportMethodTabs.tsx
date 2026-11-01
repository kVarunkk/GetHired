"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FileSpreadsheet, FileText, UserPlus } from "lucide-react";
import { jobImportPath, candidateImportPath, type ImportMethod } from "@/helpers/candidates/paths";
import { cn } from "@/utils/utils";

const METHODS: Record<ImportMethod, { label: string; icon: typeof FileText }> = {
  resumes: { label: "Resumes", icon: FileText },
  spreadsheet: { label: "Spreadsheet", icon: FileSpreadsheet },
  form: { label: "One person", icon: UserPlus },
};

/**
 * The import methods as link tabs (CP-REQ-021/031, CP-DEC-001): each one is
 * its own route, so the URL and the back button work as with a sidebar. Looks
 * like the shadcn `Tabs`; the current route is the active tab.
 */
export default function ImportMethodTabs(
  props: { jobId: string; methods?: ImportMethod[] } | { jobId?: undefined; methods?: ("resumes" | "spreadsheet")[] },
) {
  const pathname = usePathname();
  const methods = props.methods ?? (props.jobId ? (["resumes", "spreadsheet", "form"] as const) : (["resumes", "spreadsheet"] as const));
  const hrefOf = (method: ImportMethod) =>
    props.jobId ? jobImportPath(props.jobId, method) : candidateImportPath(method as "resumes" | "spreadsheet");

  return (
    <nav
      aria-label="Import methods"
      className="inline-flex h-9 max-w-full items-center self-start overflow-x-auto rounded-lg bg-muted p-1 text-muted-foreground"
    >
      {methods.map((method) => {
        const href = hrefOf(method);
        const active = pathname === href || pathname.startsWith(`${href}/`);
        const { label, icon: Icon } = METHODS[method];
        return (
          <Link
            key={method}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              active ? "bg-background text-foreground shadow" : "hover:text-foreground",
            )}
          >
            <Icon className="h-4 w-4" aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
