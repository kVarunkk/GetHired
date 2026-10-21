import { beforeEach, describe, expect, it, vi } from "vitest";
import { createReader } from "@keystatic/core/reader";
import keystaticConfig from "@/app/keystatic.config";
import { listPublicPlans, type Plan } from "@/helpers/billing/plans";
import { FAQS, LANDING_PAGES, MARKDOWN_PAGES, pageForMarkdownPath } from "./content";
import { markdocTablesToGfm, pageMarkdown } from "./markdown";

vi.mock("@/utils/platform-stats", () => ({
  getPlatformStats: vi.fn(async () => ({
    jobCount: 12345,
    applicationCount: 1,
    resumeCount: 1,
    userCount: 1,
  })),
}));
vi.mock("@/helpers/billing/plans", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/helpers/billing/plans")>()),
  listPublicPlans: vi.fn(),
}));

const plan = (overrides: Partial<Plan>): Plan => ({
  id: overrides.slug ?? "id",
  slug: "free",
  name: "Free",
  description: null,
  features: [],
  sort: 0,
  prices: [],
  entitlements: {},
  ...overrides,
});

beforeEach(() => {
  vi.mocked(listPublicPlans).mockResolvedValue([
    plan({
      slug: "free",
      name: "Free",
      entitlements: { active_job_posts: { kind: "limit", amount: 1, overageCredits: null } },
    }),
    plan({
      slug: "growth",
      name: "Growth",
      description: "For growing teams.",
      prices: [
        { interval: "month", currency: "USD", amount_minor: 4900, dodo_product_id: "p1" },
        { interval: "month", currency: "INR", amount_minor: 299900, dodo_product_id: "p2" },
      ],
      entitlements: { screenings: { kind: "allowance", amount: 500, overageCredits: 1 } },
    }),
    plan({ slug: "enterprise", name: "Enterprise" }),
  ]);
});

describe("pageForMarkdownPath", () => {
  it("maps .md paths to the pages that have a markdown version", () => {
    expect(pageForMarkdownPath("/index.md")).toBe("/");
    expect(pageForMarkdownPath("/hire.md")).toBe("/hire");
    expect(pageForMarkdownPath("/pricing/companies.md")).toBe("/pricing/companies");
    expect(pageForMarkdownPath("/blog/some-post.md")).toBe("/blog/some-post");
  });

  it("ignores everything else", () => {
    expect(pageForMarkdownPath("/hire")).toBeNull();
    expect(pageForMarkdownPath("/dashboard.md")).toBeNull();
    expect(pageForMarkdownPath("/company/agent.md")).toBeNull();
    expect(pageForMarkdownPath("/blog/../dashboard.md")).toBeNull();
    expect(pageForMarkdownPath("/blog/a/b.md")).toBeNull();
    expect(pageForMarkdownPath("/.md")).toBeNull();
  });
});

describe("pageMarkdown", () => {
  it("has a markdown version of every listed page", async () => {
    for (const page of MARKDOWN_PAGES) {
      expect(await pageMarkdown(page), page).toMatch(/^# /);
    }
  });

  it("builds a landing page from the shared copy, with absolute links", async () => {
    const md = (await pageMarkdown("/"))!;

    expect(md).toContain(`# ${LANDING_PAGES.home.heading}`);
    expect(md).toContain(LANDING_PAGES.home.subheading(12345));
    expect(md).toContain("Canonical page: https://gethired.devhub.co.in/");
    expect(md).toContain("- [Chat with the agent](https://gethired.devhub.co.in/agent)");
    expect(md).toContain("Over 12,345 listings");
    for (const faq of FAQS["job-search"]) {
      expect(md).toContain(`### ${faq.question}\n\n${faq.answer}`);
    }
  });

  it("shows a CTA with no link yet as plain text", async () => {
    expect(await pageMarkdown("/extension")).toContain("\n- Coming Soon\n");
  });

  it("lists the plans with their prices and allowances", async () => {
    const md = (await pageMarkdown("/pricing/companies"))!;

    expect(md).toContain("## Free\n\nPrice: Free\n\n- 1 active job posts");
    expect(md).toContain("## Growth\n\nPrice: $49 / month, ₹2,999 / month\n\nFor growing teams.");
    expect(md).toContain("- 500 screenings / month");
    expect(md).toContain("Price: Custom ([contact us](mailto:");
  });

  it("serves a blog post's source without its frontmatter", async () => {
    const md = (await pageMarkdown("/blog/introducing-the-get-hired-mcp-server"))!;

    expect(md).toMatch(/^# Introducing the GetHired MCP Server\n\nPublished /);
    expect(md).not.toContain("publishedAt:");
    expect(md).not.toContain("{%");
  });

  it("converts every post's Markdoc tables to GFM", async () => {
    const posts = await createReader(process.cwd(), keystaticConfig).collections.posts.list();
    for (const slug of posts) {
      expect(await pageMarkdown(`/blog/${slug}`), slug).not.toContain("{%");
    }
  });

  it("returns null for pages without a markdown version", async () => {
    expect(await pageMarkdown("/dashboard")).toBeNull();
    expect(await pageMarkdown("/blog/no-such-post")).toBeNull();
  });
});

describe("markdocTablesToGfm", () => {
  it("turns rows of list items into a GFM table", () => {
    const source = [
      "Before",
      "{% table %}",
      "- Person",
      "- Role",
      "---",
      "- Ops | lead",
      "- ",
      "{% /table %}",
      "After",
    ].join("\n");

    expect(markdocTablesToGfm(source)).toBe(
      ["Before", "| Person | Role |", "| --- | --- |", "| Ops \\| lead |  |", "After"].join("\n"),
    );
  });
});
