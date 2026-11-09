import path from "node:path";
import { Document, Font, Link, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import type { ResumeTemplate } from "@/helpers/resume/config";
import { resumeDocumentText, type ResumeDocument, type ResumeDocumentLink } from "./document";

// RE-REQ-051/052: real text in one column, so a resume stays ATS-safe. The font
// files are listed in `outputFileTracingIncludes` (next.config.ts).

const NOTO_FILES = path.join(process.cwd(), "node_modules/@fontsource/noto-sans/files");
const DEVANAGARI_FILES = path.join(process.cwd(), "node_modules/@fontsource/noto-sans-devanagari/files");

/**
 * The built-in PDF fonts silently corrupt anything outside Windows-1252: ₹
 * comes out as ¹ and a Hindi name as noise. Noto's subsets are tried in order,
 * character by character.
 */
const FONTS = [
  ["ResumeLatin", NOTO_FILES, "noto-sans-latin"],
  ["ResumeLatinExt", NOTO_FILES, "noto-sans-latin-ext"],
  ["ResumeCyrillic", NOTO_FILES, "noto-sans-cyrillic"],
  ["ResumeGreek", NOTO_FILES, "noto-sans-greek"],
  ["ResumeDevanagari", DEVANAGARI_FILES, "noto-sans-devanagari-devanagari"],
] as const;

const FONT_FAMILIES = FONTS.map(([family]) => family);

for (const [family, directory, file] of FONTS) {
  Font.register({
    family,
    fonts: [
      { src: path.join(directory, `${file}-400-normal.woff`), fontWeight: 400 },
      { src: path.join(directory, `${file}-700-normal.woff`), fontWeight: 700 },
    ],
  });
}

// Splitting words would put stray hyphens into the text an ATS reads.
Font.registerHyphenationCallback((word) => [word]);

/** A resume has text the PDF fonts can't draw. Word uses the reader's fonts, so it still works. */
export class ResumePdfCharactersError extends Error {
  constructor(readonly characters: string[]) {
    super(`A PDF can't show ${characters.join(" ")}. Change them, or download Word instead.`);
    this.name = "ResumePdfCharactersError";
  }
}

// Joiners and variation selectors shape the text around them and draw nothing.
const INVISIBLE = /[\s‌‍︀-️]/u;

const MAX_REPORTED_CHARACTERS = 5;

type LoadedFont = { hasGlyphForCodePoint: (codePoint: number) => boolean };

async function unsupportedCharacters(document: ResumeDocument): Promise<string[]> {
  const fonts = await Promise.all(
    FONT_FAMILIES.map(async (fontFamily) => {
      await Font.load({ fontFamily, fontWeight: 400 });
      return Font.getFont({ fontFamily, fontWeight: 400 }).data as unknown as LoadedFont;
    }),
  );

  const characters = new Set(Array.from(resumeDocumentText(document).join("")));
  return [...characters].filter(
    (character) =>
      !INVISIBLE.test(character) && !fonts.some((font) => font.hasGlyphForCodePoint(character.codePointAt(0)!)),
  );
}

const SCALE: Record<ResumeTemplate, { body: number; name: number; heading: number; margin: number; gap: number }> = {
  classic: { body: 10.5, name: 20, heading: 12, margin: 48, gap: 12 },
  compact: { body: 9.5, name: 16, heading: 10.5, margin: 36, gap: 8 },
};

const LINE_HEIGHT = 1.35;

function stylesFor(template: ResumeTemplate) {
  const { body, name, heading, margin, gap } = SCALE[template];
  // react-pdf turns a unitless lineHeight into points at that style's own font
  // size, and children inherit the points. Larger text must set its own.
  return StyleSheet.create({
    page: { fontFamily: [...FONT_FAMILIES], fontSize: body, lineHeight: LINE_HEIGHT, padding: margin, color: "#111111" },
    name: { fontSize: name, lineHeight: LINE_HEIGHT, fontWeight: 700 },
    headline: { marginTop: 4 },
    contact: { marginTop: 4, color: "#444444" },
    link: { color: "#444444", textDecoration: "none" },
    section: { marginTop: gap },
    heading: {
      fontSize: heading,
      lineHeight: LINE_HEIGHT,
      fontWeight: 700,
      paddingBottom: 2,
      marginBottom: 4,
      borderBottomWidth: 0.75,
      borderBottomColor: "#999999",
    },
    item: { marginBottom: gap / 2 },
    title: { fontWeight: 700 },
    meta: { color: "#444444" },
    bullet: { marginTop: 1 },
  });
}

type Styles = ReturnType<typeof stylesFor>;

function ContactPart({ part, styles }: { part: ResumeDocumentLink; styles: Styles }) {
  return part.href ? (
    <Link src={part.href} style={styles.link}>
      {part.text}
    </Link>
  ) : (
    <Text>{part.text}</Text>
  );
}

function ResumePdf({ document }: { document: ResumeDocument }) {
  const styles = stylesFor(document.template);
  return (
    <Document title={document.name ?? "Resume"}>
      <Page size="A4" style={styles.page}>
        {document.name && <Text style={styles.name}>{document.name}</Text>}
        {document.headline && <Text style={styles.headline}>{document.headline}</Text>}
        {document.contact.length > 0 && (
          <Text style={styles.contact}>
            {document.contact.map((part, index) => (
              <Text key={part.text}>
                {index > 0 && " · "}
                <ContactPart part={part} styles={styles} />
              </Text>
            ))}
          </Text>
        )}
        {document.sections.map((section) => (
          <View key={section.id} style={styles.section}>
            <Text style={styles.heading} minPresenceAhead={24}>
              {section.title}
            </Text>
            {section.items.map((item) => (
              <View key={item.id} style={styles.item}>
                {item.title && (
                  <Text style={styles.title} minPresenceAhead={12}>
                    {item.title}
                  </Text>
                )}
                {item.meta && <Text style={styles.meta}>{item.meta}</Text>}
                {item.link && <ContactPart part={item.link} styles={styles} />}
                {item.bullets.map((bullet) => (
                  <Text key={bullet.id} style={styles.bullet}>
                    {section.plain ? bullet.text : `• ${bullet.text}`}
                  </Text>
                ))}
              </View>
            ))}
          </View>
        ))}
      </Page>
    </Document>
  );
}

/** The resume as a PDF. Throws ResumePdfCharactersError rather than export corrupted text. */
export async function renderResumePdf(document: ResumeDocument): Promise<Uint8Array> {
  const unsupported = await unsupportedCharacters(document);
  if (unsupported.length > 0) throw new ResumePdfCharactersError(unsupported.slice(0, MAX_REPORTED_CHARACTERS));

  return new Uint8Array(await renderToBuffer(<ResumePdf document={document} />));
}
