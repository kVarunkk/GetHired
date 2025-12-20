import { createReader } from "@keystatic/core/reader";
import React from "react";
import Markdoc from "@markdoc/markdoc";
import keystaticConfig from "../../keystatic.config";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Metadata } from "next";
import Image from "next/image";
import { ArrowLeft } from "lucide-react";
import FootComponent from "@/components/FootComponent";

const reader = createReader(process.cwd(), keystaticConfig);
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

  const productionUrl = "https://gethired.devhub.co.in";

  const baseUrl =
    process.env.NODE_ENV === "production"
      ? productionUrl
      : process.env.NEXT_PUBLIC_VERCEL_URL
        ? `https://${process.env.NEXT_PUBLIC_VERCEL_URL}`
        : "http://localhost:3000";
  const metadataBase = new URL(baseUrl);

  const postImagePath = post.image;

  const absoluteImageUrl = postImagePath
    ? `${metadataBase.href.replace(/\/$/, "")}${postImagePath}`
    : `${metadataBase}/opengraph-image.jpg`;

  return {
    title: post.title,
    description: `Read the latest blog post "${post.title}" on GetHired.`,

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
  const errors = Markdoc.validate(node);

  if (errors.length) {
    // console.error(errors);
    throw new Error("Invalid content");
  }

  const renderable = Markdoc.transform(node);

  return (
    <div className="mx-auto   max-w-3xl px-4">
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
      <h1 className="text-5xl leading-[3.5rem] font-bold mt-4 text-center">
        {post.title}
      </h1>

      <div className="prose prose-xl mt-8 mb-20 leading-8 text-lg !text-primary prose-headings:text-primary prose-strong:text-primary prose-a:text-primary">
        {Markdoc.renderers.react(renderable, React)}
      </div>

      <FootComponent />
    </div>
  );
}
