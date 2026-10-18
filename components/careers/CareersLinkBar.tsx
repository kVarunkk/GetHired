"use client";

import Link from "next/link";
import { Copy, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { careersPath } from "@/helpers/careers/slug";
import { copyToClipboard } from "@/utils/utils";

const SITE = "https://gethired.devhub.co.in";

/** CP-REQ-014: the careers page link on the dashboard and the job posts page. */
export default function CareersLinkBar({ slug, published }: { slug: string; published: boolean }) {
  const url = `${SITE}${careersPath(slug)}`;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm">
      <span className="flex min-w-0 items-center gap-2">
        <Globe className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="font-medium">Careers page</span>
        {published ? (
          <Link href={careersPath(slug)} target="_blank" className="truncate text-muted-foreground hover:text-foreground hover:underline">
            {url.replace(/^https:\/\//, "")}
          </Link>
        ) : (
          <span className="text-muted-foreground">Not published yet</span>
        )}
      </span>
      <span className="flex gap-2">
        {published && (
          <Button type="button" size="sm" variant="outline" onClick={() => copyToClipboard(url, "Careers link copied.")}>
            <Copy className="h-3.5 w-3.5" />
            Copy link
          </Button>
        )}
        <Button asChild size="sm" variant="ghost">
          <Link href="/company/settings/careers">{published ? "Edit" : "Set it up"}</Link>
        </Button>
      </span>
    </div>
  );
}
