import { describe, expect, it } from "vitest";
import { createReader } from "@keystatic/core/reader";
import keystaticConfig from "@/app/keystatic.config";
import { BLOG_POST_TYPES } from "./post-types";

// Every post must carry a publish date and an audience: the blog list sorts
// and filters on them, and the post page picks its CTA from the type.
describe("blog posts", () => {
  it("all have a valid publishedAt and type", async () => {
    const reader = createReader(process.cwd(), keystaticConfig);
    const posts = await reader.collections.posts.all();
    expect(posts.length).toBeGreaterThan(0);
    for (const { slug, entry } of posts) {
      expect(entry.publishedAt, slug).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(BLOG_POST_TYPES, slug).toContain(entry.type);
    }
  });
});
