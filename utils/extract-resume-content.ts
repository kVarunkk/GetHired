import { TResumeRowContent } from "./types";

export const extractSectionText = <K extends string>(
  types: K[],
  resumeContent: TResumeRowContent | undefined,
): Record<K, string | undefined> => {
  // Initialize the return object with empty mappings
  const result = {} as Record<K, string | undefined>;

  // Loop through all requested section keys
  for (const type of types) {
    const section = resumeContent?.sections?.find((s) => s.type === type);

    if (!section || !section.items) {
      result[type] = undefined;
      continue;
    }

    result[type] = section.items
      .map((item) => {
        const header = item.heading
          ? `**${item.heading}** ${item.subheading ? `(${item.subheading})` : ""}\n`
          : "";
        const bulletText =
          item.bullets?.map((b) => `- ${b.text}`).join("\n") || "";
        return `${header}${bulletText}`;
      })
      .join("\n\n");
  }

  return result;
};
