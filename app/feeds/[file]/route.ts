import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { FEED_BUCKET, feedPath } from "@/helpers/distribution/feed-queue";
import { isFeedPlatform } from "@/helpers/distribution/feeds/build";

/**
 * GET /feeds/[platform].xml (MPT-022, MP-CON-002/006): serves the stored file
 * that /api/worker/feeds uploaded to the private `feeds` bucket. Never builds
 * per request. Unknown platforms, and feeds not built yet, are 404.
 * `<platform>.xml.gz` serves the same file gzipped, which Adzuna's spec
 * asks for ("highly preferable").
 */
export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const gzip = file.endsWith(".xml.gz");
  const name = gzip ? file.slice(0, -3) : file;
  const platform = name.endsWith(".xml") ? name.slice(0, -4) : null;
  if (!platform || !isFeedPlatform(platform)) return new NextResponse("Not found", { status: 404 });

  const { data } = await createServiceRoleClient().storage.from(FEED_BUCKET).download(feedPath(platform));
  if (!data) return new NextResponse("Not found", { status: 404 });

  const stream = gzip ? data.stream().pipeThrough(new CompressionStream("gzip")) : data.stream();
  return new NextResponse(stream, {
    headers: {
      "Content-Type": gzip ? "application/gzip" : "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=900, stale-while-revalidate=3600",
    },
  });
}
