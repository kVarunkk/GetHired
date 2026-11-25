import Link from "next/link";
import { Bookmark } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { SavedJobItem } from "@/helpers/tracker/types";
import { myJobsPath, trackedApplicationPath } from "@/helpers/tracker/paths";

const savedJobHref = (item: SavedJobItem) => (item.kind === "favorite" ? `/jobs/${item.allJobsId}` : trackedApplicationPath(item.id));

/** "Saved, not applied": jobs the user saved and hasn't applied to yet. Hidden when there are none. */
export default function SavedToApply({ items, total }: { items: SavedJobItem[]; total: number }) {
  if (items.length === 0) return null;

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Ready to apply</h2>
            <p className="text-sm text-muted-foreground">
              {total} saved job{total === 1 ? "" : "s"} you haven&apos;t applied to
            </p>
          </div>
          <Link className="text-sm font-medium text-muted-foreground hover:text-foreground" href={myJobsPath({ tab: "saved" })}>
            View all
          </Link>
        </div>
        <ul className="flex flex-col gap-1">
          {items.map((item) => (
            <li key={`${item.kind}:${item.id}`}>
              <Link
                href={savedJobHref(item)}
                className="group -mx-2 flex items-start gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-muted/60"
              >
                <Bookmark className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium underline-offset-4 group-hover:underline">{item.jobTitle}</span>
                  <span className="block truncate text-xs text-muted-foreground">{item.companyName}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
