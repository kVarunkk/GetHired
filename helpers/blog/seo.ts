// Search metadata for blog posts: the meta description and the JSON-LD
// (BlogPosting and FAQPage), read from the post's Markdoc tree.

/** The parts of a Markdoc node this file reads. */
export type PostNode = {
  type: string;
  attributes: Record<string, unknown>;
  children: PostNode[];
};

/** Google shows about this many characters of a description. */
export const DESCRIPTION_MAX_LENGTH = 160;

export type PostFaq = { question: string; answer: string };

/** The plain text of a node, with inline markup dropped. */
export function nodeText(node: PostNode): string {
  if (node.type === "text" || node.type === "code") {
    return String(node.attributes.content ?? "");
  }
  if (node.type === "softbreak" || node.type === "hardbreak") return " ";
  const separator = node.type === "list" || node.type === "item" ? " " : "";
  return node.children.map(nodeText).join(separator);
}

function clean(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

/** Cut at a word boundary so the text fits in `max` characters, ellipsis included. */
export function truncate(text: string, max = DESCRIPTION_MAX_LENGTH) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max / 2 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.–-]+$/, "")}…`;
}

/**
 * The post's meta description: the Keystatic `description` field when set,
 * otherwise its first paragraph (the "Quick answer", without that label).
 */
export function postDescription(root: PostNode, override?: string | null): string | null {
  const own = clean(override ?? "");
  if (own) return truncate(own);

  const paragraph = root.children.find((child) => child.type === "paragraph");
  if (!paragraph) return null;
  const text = clean(nodeText(paragraph)).replace(/^quick answer:\s*/i, "");
  return text ? truncate(text) : null;
}

const FAQ_HEADING = /^(frequently asked questions|faqs?)$/i;

/**
 * The questions under the post's "Frequently asked questions" heading: each
 * level-3 heading is a question, and the blocks under it, up to the next
 * heading, are its answer.
 */
export function postFaqs(root: PostNode): PostFaq[] {
  const blocks = root.children;
  const start = blocks.findIndex(
    (b) => b.type === "heading" && b.attributes.level === 2 && FAQ_HEADING.test(clean(nodeText(b))),
  );
  if (start === -1) return [];

  const faqs: PostFaq[] = [];
  let current: { question: string; answer: string[] } | null = null;
  const finish = () => {
    const answer = current && clean(current.answer.join(" "));
    if (current && answer) faqs.push({ question: current.question, answer });
    current = null;
  };

  for (const block of blocks.slice(start + 1)) {
    if (block.type === "heading") {
      const level = Number(block.attributes.level);
      if (level <= 2) break;
      finish();
      if (level === 3) current = { question: clean(nodeText(block)), answer: [] };
      continue;
    }
    if (current && block.type !== "hr") current.answer.push(nodeText(block));
  }
  finish();
  return faqs;
}

type PostingInput = {
  url: string;
  title: string;
  description: string | null;
  publishedAt: string;
  imageUrl: string;
  siteUrl: string;
};

export function blogPostingJsonLd({ url, title, description, publishedAt, imageUrl, siteUrl }: PostingInput) {
  const organization = {
    "@type": "Organization",
    name: "GetHired",
    url: siteUrl,
    logo: { "@type": "ImageObject", url: `${siteUrl}/icon.png` },
  };
  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: title,
    ...(description ? { description } : {}),
    image: [imageUrl],
    datePublished: publishedAt,
    dateModified: publishedAt,
    url,
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    author: organization,
    publisher: organization,
  };
}

export function faqPageJsonLd(faqs: PostFaq[]) {
  if (!faqs.length) return null;
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map(({ question, answer }) => ({
      "@type": "Question",
      name: question,
      acceptedAnswer: { "@type": "Answer", text: answer },
    })),
  };
}

/** JSON for a `<script type="application/ld+json">`, with "<" escaped so text can't end the tag. */
export function serializeJsonLd(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}
