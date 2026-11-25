import { llmsFullText } from "@/helpers/marketing/markdown";

// /llms.txt links to each page's markdown; this is the same content in one
// file, for an agent that would rather fetch once than follow every link.

export const dynamic = "force-static";
// Hourly, like the pricing page it includes.
export const revalidate = 3600;

export async function GET() {
  return new Response(await llmsFullText(), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
