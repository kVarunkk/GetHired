import { readFile } from "node:fs/promises";
import path from "node:path";
import { createReader } from "@keystatic/core/reader";
import keystaticConfig from "@/app/keystatic.config";
import { BLOG_POST_TYPE_LABELS, formatPublishedAt } from "@/helpers/blog/post-types";
import { formatPrice, listPublicPlans, type Plan } from "@/helpers/billing/plans";
import { amountLine, ENTERPRISE_HREF, SHOWN_KEYS, SIGNUP_HREF } from "@/helpers/billing/plan-lines";
import { getPlatformStats } from "@/utils/platform-stats";
import {
  ABOUT_DESCRIPTION,
  ABOUT_PARAGRAPHS,
  ABOUT_UPDATED,
  BLOG_DESCRIPTION,
  CONTACT_DESCRIPTION,
  CONTACT_EMAIL,
  FAQS,
  FOUNDER,
  FOUNDER_INTRO,
  howWeHelpCopy,
  LANDING_PAGES,
  markdownPath,
  PRICING_DESCRIPTION,
  PRICING_INTRO,
  SITE_URL,
  type LandingPageCopy,
} from "./content";

// Markdown versions of the marketing pages and blog posts, for AI agents that
// fetch a page (`/hire.md`, `/blog/<slug>.md`). Built from the same copy as the
// pages; the middleware rewrites `.md` requests to app/md/[...path]/route.ts.

const POSTS_DIR = path.join(process.cwd(), "app/content/posts");

const reader = () => createReader(process.cwd(), keystaticConfig);

/** Links in the markdown are absolute, since agents read it out of context. */
function absolute(href: string) {
  return href.startsWith("/") ? `${SITE_URL}${href}` : href;
}

function link(label: string, href: string) {
  return `[${label}](${absolute(href)})`;
}

/** The title, the canonical page and a one-line summary. */
function header(title: string, pagePath: string, summary: string) {
  return [`# ${title}`, `> ${summary}`, `Canonical page: ${absolute(pagePath)}`];
}

function landingMarkdown(page: LandingPageCopy, jobCount: number) {
  const help = howWeHelpCopy(page.howWeHelp, jobCount);
  const ctas = page.ctas.map((c) => (c.href === "#" ? `- ${c.label}` : `- ${link(c.label, c.href)}`));

  return [
    ...header(page.heading, page.path, page.description),
    page.subheading(jobCount),
    ctas.join("\n"),
    `## ${help.heading}`,
    help.subheading,
    help.features.map((f) => `- **${f.name}.** ${f.description}`).join("\n"),
    "## Frequently asked questions",
    ...FAQS[page.faq].map((f) => `### ${f.question}\n\n${f.answer}`),
    ...(page.related?.length
      ? ["## Related", page.related.map((l) => `- ${link(l.label, l.href)}`).join("\n")]
      : []),
  ];
}

function aboutMarkdown() {
  return [
    ...header("About GetHired", "/about", ABOUT_DESCRIPTION),
    `Last updated: ${ABOUT_UPDATED}`,
    `Hi, I'm ${link(FOUNDER.name, FOUNDER.url)}. ${FOUNDER_INTRO}`,
    ...ABOUT_PARAGRAPHS,
    `Contact: ${CONTACT_EMAIL}`,
  ];
}

function contactMarkdown() {
  return [
    ...header("Contact", "/contact", CONTACT_DESCRIPTION),
    `Hi, I'm ${link(FOUNDER.name, FOUNDER.url)}. ${FOUNDER_INTRO}`,
    `You can contact me here on my email: ${CONTACT_EMAIL}`,
  ];
}

/** "Free", "Custom", or every listed price: "$49 / month, $490 / year, ₹2,999 / month". */
function planPrice(plan: Plan) {
  if (plan.slug === "free") return "Free";
  if (plan.prices.length === 0) return `Custom (${link("contact us", ENTERPRISE_HREF)})`;
  return plan.prices.map((p) => `${formatPrice(p)} / ${p.interval}`).join(", ");
}

function planAction(plan: Plan) {
  if (plan.slug !== "free" && plan.prices.length === 0) return null;
  return link(plan.slug === "free" ? "Start free" : `Start with ${plan.name}`, SIGNUP_HREF);
}

async function pricingMarkdown() {
  const plans = await listPublicPlans();
  return [
    ...header("Pricing for companies", "/pricing/companies", PRICING_DESCRIPTION),
    PRICING_INTRO,
    ...plans.map((plan) => {
      const lines = SHOWN_KEYS.map((key) => amountLine(plan, key)).filter((l) => l !== null);
      const action = planAction(plan);
      return [
        `## ${plan.name}`,
        `Price: ${planPrice(plan)}`,
        ...(plan.description ? [plan.description] : []),
        ...(lines.length ? [lines.map((l) => `- ${l}`).join("\n")] : []),
        ...(action ? [action] : []),
      ].join("\n\n");
    }),
  ];
}

async function blogIndexMarkdown() {
  const posts = (await reader().collections.posts.all()).sort((a, b) =>
    b.entry.publishedAt.localeCompare(a.entry.publishedAt),
  );
  return [
    ...header("GetHired blog", "/blog", BLOG_DESCRIPTION),
    "Each post has a markdown version at `/blog/<slug>.md`.",
    posts
      .map(
        ({ slug, entry }) =>
          `- ${link(entry.title, markdownPath(`/blog/${slug}`))} (${formatPublishedAt(entry.publishedAt)}, ${BLOG_POST_TYPE_LABELS[entry.type].toLowerCase()})`,
      )
      .join("\n"),
  ];
}

/**
 * Markdoc's `{% table %}` blocks (rows split by `---`, one `- cell` per line)
 * as GFM tables, which agents read without knowing Markdoc.
 */
export function markdocTablesToGfm(source: string) {
  return source.replace(/\{% table %\}\n([\s\S]*?)\n\{% \/table %\}/g, (_, body: string) => {
    const rows = body.split(/\n---\n/).map((row) => {
      const cells: string[] = [];
      for (const line of row.split("\n")) {
        const cell = line.match(/^[-*] ?(.*)$/);
        if (cell) cells.push(cell[1].trim());
        else if (cells.length && line.trim()) cells[cells.length - 1] += ` ${line.trim()}`;
      }
      return `| ${cells.map((c) => c.replace(/\|/g, "\\|")).join(" | ")} |`;
    });
    const columns = rows[0].split(" | ").length;
    const divider = `|${" --- |".repeat(columns)}`;
    return [rows[0], divider, ...rows.slice(1)].join("\n");
  });
}

async function blogPostMarkdown(slug: string) {
  const post = await reader().collections.posts.read(slug);
  if (!post) return null;

  const source = (await readFile(path.join(POSTS_DIR, `${slug}.mdoc`), "utf8")).replace(/\r\n/g, "\n");
  const body = source.replace(/^---\n[\s\S]*?\n---\n/, "").trim();

  return [
    `# ${post.title}`,
    `Published ${formatPublishedAt(post.publishedAt)} · ${BLOG_POST_TYPE_LABELS[post.type]}`,
    `Canonical page: ${absolute(`/blog/${slug}`)}`,
    markdocTablesToGfm(body),
  ];
}

/** The markdown version of a page (`/`, `/hire`, `/blog/<slug>`...), or null if it has none. */
export async function pageMarkdown(pagePath: string): Promise<string | null> {
  let blocks: string[] | null;

  const landing = Object.values(LANDING_PAGES).find((p) => p.path === pagePath);
  if (landing) {
    const { jobCount } = await getPlatformStats();
    blocks = landingMarkdown(landing, jobCount);
  } else if (pagePath === "/about") {
    blocks = aboutMarkdown();
  } else if (pagePath === "/contact") {
    blocks = contactMarkdown();
  } else if (pagePath === "/pricing/companies") {
    blocks = await pricingMarkdown();
  } else if (pagePath === "/blog") {
    blocks = await blogIndexMarkdown();
  } else {
    const slug = pagePath.match(/^\/blog\/([a-z0-9-]+)$/)?.[1];
    blocks = slug ? await blogPostMarkdown(slug) : null;
  }

  return blocks ? `${blocks.join("\n\n")}\n` : null;
}
