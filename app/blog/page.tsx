import { createReader } from "@keystatic/core/reader";
import keystaticConfig from "../keystatic.config";
import FootComponent from "@/components/FootComponent";
import BlogPostList from "@/components/blog/BlogPostList";
import type { BlogPostSummary } from "@/helpers/blog/post-types";
import { Metadata } from "next";
import { BLOG_DESCRIPTION, markdownAlternate } from "@/helpers/marketing/content";

export const revalidate = 86400;
export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Job Search Advice, Career Tips & Hiring Insights",
  description: BLOG_DESCRIPTION,
  alternates: {
    canonical: "/blog",
    types: markdownAlternate("/blog"),
  },
  openGraph: {
    type: "website",
    siteName: "GetHired",
    title: "Job Search Advice, Career Tips & Hiring Insights",
    description: BLOG_DESCRIPTION,
    url: "/blog",
  },
};

const reader = createReader(process.cwd(), keystaticConfig);

export default async function Page() {
  const posts = await reader.collections.posts.all();
  const summaries: BlogPostSummary[] = posts.map((post) => ({
    slug: post.slug,
    title: post.entry.title,
    image: post.entry.image,
    publishedAt: post.entry.publishedAt,
    type: post.entry.type,
  }));

  return (
    <div>
      <div className="mx-auto mb-20 max-w-6xl px-4">
        <h1 className="text-5xl sm:text-7xl font-semibold tracking-tight leading-[1.1] mb-12 text-center">
          Blog
        </h1>
        <BlogPostList posts={summaries} />
      </div>
      <div className="px-4 lg:px-20 xl:px-40 2xl:px-80">
        <FootComponent />
      </div>
    </div>
  );
}
