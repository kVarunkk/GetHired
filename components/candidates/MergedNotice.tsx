import Link from "next/link";
import { GitMerge } from "lucide-react";

/**
 * BI-REQ-042: an application's merges. On the imported one that was merged
 * (`mergedInto`), it says the page is read-only and links the application
 * the person sent; on that one (`mergedFrom`), it links the import's notes,
 * events and screening.
 */
export default function MergedNotice({ mergedInto, mergedFrom }: { mergedInto: string | null; mergedFrom: string[] }) {
  if (!mergedInto && mergedFrom.length === 0) return null;
  return (
    <div role="note" className="flex items-start gap-2 rounded-lg border bg-muted/40 px-4 py-3 text-sm">
      <GitMerge className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      {mergedInto ? (
        <p>
          This imported application was merged into the one the candidate sent through GetHired. It&apos;s kept
          read-only.{" "}
          <Link href={`/company/applications/${mergedInto}`} className="underline underline-offset-4">
            Open their application
          </Link>
        </p>
      ) : (
        <p>
          Merged from an import:{" "}
          {mergedFrom.map((id, i) => (
            <span key={id}>
              {i > 0 && ", "}
              <Link href={`/company/applications/${id}/notes`} className="underline underline-offset-4">
                {mergedFrom.length === 1 ? "see its notes, activity and screening" : `import ${i + 1}`}
              </Link>
            </span>
          ))}
        </p>
      )}
    </div>
  );
}
