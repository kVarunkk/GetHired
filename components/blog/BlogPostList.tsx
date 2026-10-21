"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Newspaper, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import ScrollMaskX from "@/components/ScrollMaskX";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BLOG_POST_TYPES,
  BLOG_POST_TYPE_LABELS,
  formatPublishedAt,
  type BlogPostSummary,
  type BlogPostType,
} from "@/helpers/blog/post-types";

type TypeFilter = "all" | BlogPostType;
type Sort = "newest" | "oldest";

export default function BlogPostList({ posts }: { posts: BlogPostSummary[] }) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState<TypeFilter>("all");
  const [sort, setSort] = useState<Sort>("newest");

  const visible = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const filtered = posts.filter((post) => {
      if (type !== "all" && post.type !== type) return false;
      const title = post.title.toLowerCase();
      return words.every((word) => title.includes(word));
    });
    // `YYYY-MM-DD` sorts as a string; ties fall back to the title.
    return filtered.sort((a, b) => {
      const byDate = a.publishedAt.localeCompare(b.publishedAt);
      return (
        (sort === "newest" ? -byDate : byDate) || a.title.localeCompare(b.title)
      );
    });
  }, [posts, query, type, sort]);

  const filtering = query.trim() !== "" || type !== "all";

  return (
    <div>
      <div className="mb-8 flex flex-col gap-3 md:flex-row md:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search posts"
            aria-label="Search posts"
            className="pl-9"
          />
        </div>
        <div className="flex min-w-0 items-center gap-3">
          <Tabs
            value={type}
            onValueChange={(v) => setType(v as TypeFilter)}
            className="min-w-0 flex-1 md:flex-none"
          >
            <ScrollMaskX revealSelector='[role="tab"][data-state="active"]'>
              <TabsList>
                <TabsTrigger value="all">All</TabsTrigger>
                {BLOG_POST_TYPES.map((t) => (
                  <TabsTrigger key={t} value={t}>
                    {BLOG_POST_TYPE_LABELS[t]}
                  </TabsTrigger>
                ))}
              </TabsList>
            </ScrollMaskX>
          </Tabs>
          <Select value={sort} onValueChange={(v) => setSort(v as Sort)}>
            <SelectTrigger className="w-36 shrink-0" aria-label="Sort posts">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Newest first</SelectItem>
              <SelectItem value="oldest">Oldest first</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="rounded-xl border p-10 text-center">
          <p className="text-muted-foreground">No posts match your search.</p>
          {filtering && (
            <Button
              variant="outline"
              className="mt-4"
              onClick={() => {
                setQuery("");
                setType("all");
              }}
            >
              Clear filters
            </Button>
          )}
        </div>
      ) : (
        <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((post, index) => (
            <li key={post.slug}>
              <Link
                href={`/blog/${post.slug}`}
                className="group flex h-full flex-col overflow-hidden rounded-xl border bg-card transition-colors hover:border-foreground/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="relative aspect-[16/9] w-full overflow-hidden bg-muted">
                  {post.image ? (
                    <Image
                      src={post.image}
                      alt={post.title}
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
                <div className="flex flex-1 flex-col gap-3 p-4">
                  <h2 className="text-lg font-semibold tracking-tight leading-snug group-hover:underline">
                    {post.title}
                  </h2>
                  <div className="mt-auto flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                    <Badge variant="outline">
                      {BLOG_POST_TYPE_LABELS[post.type]}
                    </Badge>
                    <time dateTime={post.publishedAt}>
                      {formatPublishedAt(post.publishedAt)}
                    </time>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
