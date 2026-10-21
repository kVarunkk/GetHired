import { createReader } from "@keystatic/core/reader";
import React from "react";
import Markdoc, { type Config, type Node } from "@markdoc/markdoc";
import keystaticConfig from "../../keystatic.config";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Metadata } from "next";
import Image from "next/image";
import { ArrowLeft } from "lucide-react";
import FootComponent from "@/components/FootComponent";
import BlogSidebarCTA from "@/components/BlogSidebarCTA";
import BlogSidebarCompanyCTA from "@/components/BlogSidebarCompanyCTA";
import { Badge } from "@/components/ui/badge";
import {
  BLOG_POST_TYPE_LABELS,
  formatPublishedAt,
} from "@/helpers/blog/post-types";
import { deploymentUrl } from "@/utils/formatters";

const reader = createReader(process.cwd(), keystaticConfig);

// Wrap tables in a horizontally scrollable container so wide tables don't
// make the whole page scroll sideways on small screens.
const markdocConfig = {
  nodes: {
    table: {
      ...Markdoc.nodes.table,
      transform(node: Node, config: Config) {
        return new Markdoc.Tag("div", { class: "overflow-x-auto" }, [
          new Markdoc.Tag(
            "table",
            node.transformAttributes(config),
            node.transformChildren(config),
          ),
        ]);
      },
    },
    // Inline code: prose's default code colour is a fixed dark gray (unreadable
    // on the dark theme) and it wraps code in literal backticks.
    code: {
      ...Markdoc.nodes.code,
      transform(node: Node) {
        return new Markdoc.Tag(
          "code",
          {
            class:
              "rounded bg-muted px-1.5 py-0.5 text-[0.85em] font-medium text-primary before:content-none after:content-none",
          },
          [node.attributes.content],
        );
      },
    },
  },
};

type tParams = Promise<{ slug: string }>;

export async function generateMetadata({
  params,
}: {
  params: tParams;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = await reader.collections.posts.read(slug);

  if (!post) {
    return {};
  }

  const baseUrl = deploymentUrl();

  const metadataBase = new URL(baseUrl);

  const postImagePath = post.image;

  const absoluteImageUrl = postImagePath
    ? `${metadataBase.href.replace(/\/$/, "")}${postImagePath}`
    : `${metadataBase}/opengraph-image.jpg`;

  return {
    title: post.title,
    description: `Read the latest blog post "${post.title}" on GetHired.`,
    alternates: { canonical: `/blog/${slug}` },

    openGraph: {
      title: post.title,
      description: `Read the latest blog post "${post.title}" on GetHired.`,
      url: `${baseUrl}/blog/${slug}`,
      siteName: "GetHired",
      images: [
        {
          url: absoluteImageUrl,
          width: 1200,
          height: 630,
          alt: post.title,
        },
      ],
      locale: "en_US",
      type: "article",
      publishedTime: post.publishedAt,
    },

    twitter: {
      card: "summary_large_image",
      title: post.title,
      description: `Read the latest blog post "${post.title}" on GetHired.`,
      images: [absoluteImageUrl],
    },
  };
}

export async function generateStaticParams() {
  const posts = await reader.collections.posts.all();
  return posts.map((post) => ({ slug: post.slug }));
}

export default async function Post({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const finalParms = await params;
  const post = await reader.collections.posts.read(finalParms.slug);

  if (!post) {
    notFound();
  }

  const imageUrl = post.image;

  const { node } = await post.content();
  const markdocNode = node;

  // @ts-expect-error some motherfucking type error
  const errors = Markdoc.validate(markdocNode);

  if (errors.length) {
    throw new Error("Invalid content");
  }
  // @ts-expect-error some motherfucking type error
  const renderable = Markdoc.transform(markdocNode, markdocConfig);

  return (
    <div className="mx-auto max-w-6xl px-4">
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_18rem] lg:gap-12">
        <article className="min-w-0">
          <Link href={"/blog"}>
            <button className="text-muted-foreground hover:text-primary transition-colors mt-2">
              <ArrowLeft className="h-4 w-4" />
            </button>{" "}
          </Link>

          {imageUrl && (
            <div
              className="relative w-full rounded-lg my-6"
              style={{ maxHeight: "24rem", height: "50vw" }}
            >
              <Image
                src={imageUrl}
                alt={post.title}
                fill
                sizes="(max-width: 1024px) 100vw, 768px"
                style={{ objectFit: "cover" }}
                priority
                className="rounded-lg"
              />
            </div>
          )}
          <h1 className="text-3xl font-semibold tracking-tight mt-4 text-center [overflow-wrap:anywhere] sm:text-4xl lg:text-5xl lg:leading-[3.5rem]">
            {post.title}
          </h1>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-3 text-sm text-muted-foreground">
            <Badge variant="outline">{BLOG_POST_TYPE_LABELS[post.type]}</Badge>
            <time dateTime={post.publishedAt}>
              {formatPublishedAt(post.publishedAt)}
            </time>
          </div>

          {/* overflow-wrap: anywhere lets bare URLs and other long strings
              wrap instead of pushing the page sideways on small screens. */}
          <div className="prose prose-xl [overflow-wrap:anywhere] mt-8 mb-12 leading-8 text-lg !text-primary prose-headings:text-primary prose-strong:text-primary prose-a:text-primary lg:mb-20">
            {Markdoc.renderers.react(renderable, React)}
          </div>
        </article>

        {/* Below the article on small screens; a sticky right rail on lg+. */}
        <aside className="mb-20">
          <div className="lg:sticky lg:top-8 lg:mt-14">
            {post.type === "companies" ? (
              <BlogSidebarCompanyCTA />
            ) : (
              <BlogSidebarCTA />
            )}
          </div>
        </aside>
      </div>

      <FootComponent />
    </div>
  );
}
