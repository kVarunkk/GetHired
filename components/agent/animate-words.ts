import type { Element, ElementContent, Root } from "hast";

/** Text inside these is left whole: code shouldn't be split into spans. */
const SKIP = new Set(["code", "pre"]);

function wrapWords(children: ElementContent[]): ElementContent[] {
  return children.flatMap((child): ElementContent[] => {
    if (child.type === "element") {
      if (!SKIP.has(child.tagName)) child.children = wrapWords(child.children);
      return [child];
    }
    if (child.type !== "text") return [child];

    return child.value
      .split(/(\s+)/)
      .filter((piece) => piece !== "")
      .map((piece): ElementContent =>
        /^\s+$/.test(piece)
          ? { type: "text", value: piece }
          : ({
              type: "element",
              tagName: "span",
              properties: { className: ["agent-word"] },
              children: [{ type: "text", value: piece }],
            } satisfies Element),
      );
  });
}

/**
 * Rehype plugin for a reply that is still streaming: wraps each word in a
 * span that fades in when it mounts. react-markdown keys elements by tag and
 * position, so words already shown keep their span and don't animate again;
 * only newly arrived words do.
 */
export function rehypeAnimateWords() {
  return (tree: Root) => {
    tree.children = wrapWords(tree.children as ElementContent[]) as Root["children"];
  };
}
