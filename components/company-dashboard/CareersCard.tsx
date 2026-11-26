"use client";

import Link from "next/link";
import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { careersPath } from "@/helpers/careers/slug";
import { copyToClipboard } from "@/utils/utils";

const SITE = "https://gethired.devhub.co.in";
const SETTINGS = "/company/settings/careers";

/**
 * CD-REQ-028: the careers page. Live, its address; set up but unpublished, a
 * way to publish it for members who can. A company without one finds it in
 * the setup checklist instead.
 */
export default function CareersCard({
  slug,
  published,
  canEdit,
}: {
  slug: string;
  published: boolean;
  canEdit: boolean;
}) {
  if (!published && !canEdit) return null;
  const url = `${SITE}${careersPath(slug)}`;

  return (
    <Card>
      <CardContent className="flex flex-col items-start gap-3 p-4">
        <div className="min-w-0 max-w-full">
          <h2 className="text-lg font-semibold tracking-tight">Careers page</h2>
          {published ? (
            <Link
              href={careersPath(slug)}
              target="_blank"
              className="block truncate text-sm text-muted-foreground hover:text-foreground hover:underline"
            >
              {url.replace(/^https:\/\//, "")}
            </Link>
          ) : (
            <p className="text-sm text-muted-foreground">Not published yet</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {published ? (
            <>
              <Button type="button" size="sm" variant="outline" onClick={() => copyToClipboard(url, "Careers link copied.")}>
                <Copy className="h-3.5 w-3.5" />
                Copy link
              </Button>
              {canEdit && (
                <Button asChild size="sm" variant="ghost">
                  <Link href={SETTINGS}>Edit</Link>
                </Button>
              )}
            </>
          ) : (
            <Button asChild size="sm" variant="outline">
              <Link href={SETTINGS}>Publish your careers page</Link>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
