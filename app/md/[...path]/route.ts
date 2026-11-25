import { SITE_URL } from "@/helpers/marketing/content";
import { pageMarkdown } from "@/helpers/marketing/markdown";

// Markdown versions of the marketing pages and blog posts. Reached through the
// middleware, which rewrites `/hire.md` to `/md/hire` and `/index.md` to `/md/index`.

export const dynamic = "force-static";
// Hourly, like the pricing page.
export const revalidate = 3600;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  const pagePath = path.join("/") === "index" ? "/" : `/${path.join("/")}`;
  const markdown = await pageMarkdown(pagePath);

  if (!markdown) {
    return new Response("Not found\n", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  return new Response(markdown, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      // The HTML page is the one to index and cite; this is its plain-text copy.
      Link: `<${SITE_URL}${pagePath === "/" ? "" : pagePath}>; rel="canonical"`,
    },
  });
}
