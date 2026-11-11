import { describe, expect, it } from "vitest";
import Markdoc from "@markdoc/markdoc";
import { createReader } from "@keystatic/core/reader";
import keystaticConfig from "@/app/keystatic.config";
import {
  DESCRIPTION_MAX_LENGTH,
  blogPostingJsonLd,
  faqPageJsonLd,
  postDescription,
  postFaqs,
  serializeJsonLd,
  truncate,
  type PostNode,
} from "./seo";

const parse = (source: string) => Markdoc.parse(source) as unknown as PostNode;

const POST = `**Quick answer:** Use a *single-column* layout and [standard headings](https://example.com).

More text.

## Frequently asked questions

### Is PDF or Word better?

Both usually work.

A text-based PDF is safest.

### What is a good \`ATS\` score?

- Scores vary
- Focus on parsing

---

## Next steps

### Not a question

Ignored.
`;

describe("postDescription", () => {
  it("uses the first paragraph without the Quick answer label or markup", () => {
    expect(postDescription(parse(POST))).toBe(
      "Use a single-column layout and standard headings.",
    );
  });

  it("prefers the description field when set", () => {
    expect(postDescription(parse(POST), "  Hand written.  ")).toBe("Hand written.");
    expect(postDescription(parse(POST), "   ")).toBe("Use a single-column layout and standard headings.");
  });

  it("returns null when there is no paragraph", () => {
    expect(postDescription(parse("## Only a heading"))).toBeNull();
  });

  it("cuts long text at a word boundary", () => {
    const text = "word ".repeat(100).trim();
    const out = truncate(text);
    expect(out.length).toBeLessThanOrEqual(DESCRIPTION_MAX_LENGTH);
    expect(out).toMatch(/word…$/);
  });
});

describe("postFaqs", () => {
  it("reads level-3 questions and their answers under the FAQ heading only", () => {
    expect(postFaqs(parse(POST))).toEqual([
      { question: "Is PDF or Word better?", answer: "Both usually work. A text-based PDF is safest." },
      { question: "What is a good ATS score?", answer: "Scores vary Focus on parsing" },
    ]);
  });

  it("is empty without an FAQ heading", () => {
    expect(postFaqs(parse("## Intro\n\n### Q?\n\nA."))).toEqual([]);
  });
});

describe("JSON-LD", () => {
  it("builds a BlogPosting", () => {
    expect(
      blogPostingJsonLd({
        url: "https://site/blog/a",
        title: "A",
        description: "D",
        publishedAt: "2026-11-11",
        imageUrl: "https://site/i.jpg",
        siteUrl: "https://site",
      }),
    ).toMatchObject({
      "@type": "BlogPosting",
      headline: "A",
      description: "D",
      datePublished: "2026-11-11",
      mainEntityOfPage: { "@id": "https://site/blog/a" },
      publisher: { name: "GetHired", logo: { url: "https://site/icon.png" } },
    });
  });

  it("has no FAQPage without questions", () => {
    expect(faqPageJsonLd([])).toBeNull();
    expect(faqPageJsonLd([{ question: "Q", answer: "A" }])).toMatchObject({
      "@type": "FAQPage",
      mainEntity: [{ name: "Q", acceptedAnswer: { text: "A" } }],
    });
  });

  it("escapes < so text can't close the script tag", () => {
    const out = serializeJsonLd({ text: "</script><script>alert(1)</script>" });
    expect(out).not.toContain("<");
    expect(JSON.parse(out).text).toBe("</script><script>alert(1)</script>");
  });
});

// Every real post must produce a description, and posts with an FAQ section
// must produce its questions, so a formatting slip can't silently drop them.
describe("blog posts' search metadata", () => {
  it("all have a description and their FAQs parse", async () => {
    const reader = createReader(process.cwd(), keystaticConfig);
    const posts = await reader.collections.posts.all();
    for (const { slug, entry } of posts) {
      const { node } = await entry.content();
      const root = node as unknown as PostNode;
      const description = postDescription(root, entry.description);
      expect(description, slug).toBeTruthy();
      expect(description!.length, slug).toBeLessThanOrEqual(DESCRIPTION_MAX_LENGTH);

      const hasFaqHeading = root.children.some(
        (b) => b.type === "heading" && b.attributes.level === 2 && /frequently asked questions/i.test(JSON.stringify(b)),
      );
      if (hasFaqHeading) expect(postFaqs(root).length, slug).toBeGreaterThan(0);
    }
  });
});
