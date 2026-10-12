import { createReader } from "@keystatic/core/reader";
import keystaticConfig from "../keystatic.config";
import Link from "next/link";
import Image from "next/image";
import { Newspaper } from "lucide-react";
import FootComponent from "@/components/FootComponent";
import { Metadata } from "next";

export const revalidate = 86400;
export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Job Search Advice, Career Tips & Hiring Insights",
  description:
    "Practical job-search advice, career guidance, and product updates from GetHired.",
  alternates: {
    canonical: "/blog",
  },
  openGraph: {
    type: "website",
    siteName: "GetHired",
    title: "Job Search Advice, Career Tips & Hiring Insights",
    description:
      "Practical job-search advice, career guidance, and product updates from GetHired.",
    url: "/blog",
  },
};

const reader = createReader(process.cwd(), keystaticConfig);

export default async function Page() {
  const posts = await reader.collections.posts.all();
  // Posts with a cover image first; otherwise keep the reader's order.
  const sortedPosts = [...posts].sort(
    (a, b) => Number(Boolean(b.entry.image)) - Number(Boolean(a.entry.image)),
  );

  return (
    <div>
      <div className="mx-auto mb-20 max-w-6xl px-4">
        <h1 className="text-5xl sm:text-7xl font-semibold tracking-tight leading-[1.1] mb-12 text-center">
          Blog
        </h1>
        <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {sortedPosts.map((post, index) => (
            <li key={post.slug}>
              <Link
                href={`/blog/${post.slug}`}
                className="group flex h-full flex-col overflow-hidden rounded-xl border bg-card transition-colors hover:border-foreground/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="relative aspect-[16/9] w-full overflow-hidden bg-muted">
                  {post.entry.image ? (
                    <Image
                      src={post.entry.image}
                      alt={post.entry.title}
                      fill
                      sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 384px"
                      priority={index < 3}
                      className="object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-brandSoft">
                      <Newspaper className="h-10 w-10 text-brand" />
                    </div>
                  )}
                </div>
                <h2 className="p-4 text-lg font-semibold tracking-tight leading-snug group-hover:underline">
                  {post.entry.title}
                </h2>
              </Link>
            </li>
          ))}
        </ul>
      </div>
      <div className="px-4 lg:px-20 xl:px-40 2xl:px-80">
        <FootComponent />
      </div>
    </div>
  );
}
