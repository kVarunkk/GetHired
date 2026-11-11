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
import { markdownAlternate } from "@/helpers/marketing/content";
import {
  blogPostingJsonLd,
  faqPageJsonLd,
  postDescription,
  postFaqs,
  serializeJsonLd,
  type PostNode,
} from "@/helpers/blog/seo";

const reader = createReader(process.cwd(), keystaticConfig);

type BlogPost = {
  title: string;
  description: string;
  image: string | null;
  content: () => Promise<{ node: unknown }>;
};

function siteUrl() {
  return deploymentUrl().replace(/\/$/, "");
}

/** The post's image, or the site's default share image, as an absolute URL. */
function postImageUrl(post: BlogPost) {
  return `${siteUrl()}${post.image ?? "/opengraph-image.jpg"}`;
}

async function postSeo(post: BlogPost) {
  const { node } = await post.content();
  const root = node as unknown as PostNode;
  return {
    description:
      postDescription(root, post.description) ??
      `Read "${post.title}" on the GetHired blog.`,
    faqs: postFaqs(root),
  };
}

// Wrap tables in a horizontally scrollable container so wide tables don't
// make the whole page scroll sideways on small screens.
const markdocConfig = {
  nodes: {
    table: {
      ...Markdoc.nodes.table,
      transform(node: Node, config: Config) {
        // A bordered, rounded frame with a muted header row. Prose's default
        // row borders are fixed grays (harsh on the dark theme), so borders,
        // header and text use theme tokens instead. Cells keep a minimum
        // width, so on narrow screens the table scrolls sideways instead of
        // squeezing each column to a word per line.
        return new Markdoc.Tag(
          "div",
          {
            class:
              "not-prose my-8 overflow-x-auto rounded-lg border border-border",
          },
          [
            new Markdoc.Tag(
              "table",
              {
                ...node.transformAttributes(config),
                class:
                  "w-full border-collapse text-left text-sm leading-6 text-primary sm:text-base [&_th]:min-w-[9rem] [&_td]:min-w-[9rem] [&_th]:bg-muted [&_th]:px-3 [&_th]:py-2.5 [&_th]:align-bottom [&_th]:font-semibold [&_td]:px-3 [&_td]:py-2.5 sm:[&_th]:px-4 sm:[&_th]:py-3 sm:[&_td]:px-4 sm:[&_td]:py-3 [&_td]:align-top [&_tr]:border-b [&_tr]:border-border [&_tbody_tr:last-child]:border-b-0 [&_tbody_tr:hover]:bg-muted/40 [&_a]:font-medium [&_a]:underline [&_a]:underline-offset-2",
              },
              node.transformChildren(config),
            ),
          ],
        );
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

  const baseUrl = siteUrl();
  const absoluteImageUrl = postImageUrl(post);
  const { description } = await postSeo(post);

  return {
    title: post.title,
    description,
    alternates: {
      canonical: `/blog/${slug}`,
      types: markdownAlternate(`/blog/${slug}`),
    },

    openGraph: {
      title: post.title,
      description,
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
      description,
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

  const { description, faqs } = await postSeo(post);
  const jsonLd = [
    blogPostingJsonLd({
      url: `${siteUrl()}/blog/${finalParms.slug}`,
      title: post.title,
      description,
      publishedAt: post.publishedAt,
      imageUrl: postImageUrl(post),
      siteUrl: siteUrl(),
    }),
    faqPageJsonLd(faqs),
  ].filter(Boolean);

  return (
    <div className="mx-auto max-w-6xl px-4">
      {jsonLd.map((data, i) => (
        <script
          key={i}
          type="application/ld+json"
          // Escaped so post text like "</script>" can't end the tag.
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
        />
      ))}
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
              wrap instead of pushing the page sideways on small screens.
              Blockquotes: prose's default quote colour is a fixed near-black
              (unreadable on the dark theme), so they use theme tokens, drop
              the italics and the added quote marks. */}
          <div className="prose prose-xl [overflow-wrap:anywhere] mt-8 mb-12 leading-8 text-lg !text-primary prose-headings:text-primary prose-strong:text-primary prose-a:text-primary prose-blockquote:rounded-r-lg prose-blockquote:border-l-muted-foreground/40 prose-blockquote:bg-muted/50 prose-blockquote:py-1 prose-blockquote:pr-4 prose-blockquote:font-normal prose-blockquote:not-italic prose-blockquote:text-primary [&_blockquote_p]:before:content-none [&_blockquote_p]:after:content-none lg:mb-20">
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
