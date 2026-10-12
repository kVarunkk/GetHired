import { describe, expect, it } from "vitest";
import type { Root } from "hast";
import { rehypeAnimateWords } from "./animate-words";

const word = (value: string) => ({
  type: "element",
  tagName: "span",
  properties: { className: ["agent-word"] },
  children: [{ type: "text", value }],
});

const run = (tree: Root) => {
  rehypeAnimateWords()(tree);
  return tree;
};

describe("rehypeAnimateWords", () => {
  it("wraps each word in a fading span and keeps the spaces between them", () => {
    const tree = run({
      type: "root",
      children: [
        {
          type: "element",
          tagName: "p",
          properties: {},
          children: [{ type: "text", value: "Found  two\njobs" }],
        },
      ],
    });

    expect((tree.children[0] as { children: unknown[] }).children).toEqual([
      word("Found"),
      { type: "text", value: "  " },
      word("two"),
      { type: "text", value: "\n" },
      word("jobs"),
    ]);
  });

  it("reaches text inside nested elements like links and bold", () => {
    const tree = run({
      type: "root",
      children: [
        {
          type: "element",
          tagName: "strong",
          properties: {},
          children: [{ type: "text", value: "Senior Dev" }],
        },
      ],
    });

    expect((tree.children[0] as { children: unknown[] }).children).toEqual([
      word("Senior"),
      { type: "text", value: " " },
      word("Dev"),
    ]);
  });

  it("leaves code alone", () => {
    const code = { type: "text" as const, value: "npm run dev" };
    const tree = run({
      type: "root",
      children: [{ type: "element", tagName: "code", properties: {}, children: [code] }],
    });

    expect((tree.children[0] as { children: unknown[] }).children).toEqual([code]);
  });
});
