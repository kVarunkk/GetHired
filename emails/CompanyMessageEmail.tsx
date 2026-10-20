import * as React from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import { Body, Container, Head, Html, Img, Link, Preview, Section, Text } from "react-email";

interface CompanyMessageEmailProps {
  companyName: string;
  companyEmail: string | null;
  logoUrl: string | null;
  subject: string;
  /** The rendered template (markdown). Raw HTML in it is escaped, not rendered. */
  bodyMd: string;
}

const text: React.CSSProperties = { fontSize: "15px", lineHeight: "24px", color: "#1f2937", margin: "0 0 16px" };
const muted: React.CSSProperties = { fontSize: "12px", lineHeight: "18px", color: "#6b7280", margin: 0 };

// react-markdown escapes raw HTML and drops javascript: URLs. No images: a
// company can't make the candidate's client load a tracking pixel.
const COMPONENTS: Components = {
  p: ({ children }) => <Text style={text}>{children}</Text>,
  a: ({ href, children }) => (
    <Link href={href} style={{ color: "#4f46e5", textDecoration: "underline" }}>
      {children}
    </Link>
  ),
  img: () => null,
};

/**
 * A company's message to a candidate (PL-TASK-031): the company's name and
 * logo, the body from its template, and a footer saying who sent it.
 */
export default function CompanyMessageEmail({
  companyName,
  companyEmail,
  logoUrl,
  subject,
  bodyMd,
}: CompanyMessageEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>{""}</Preview>
      <Body style={{ backgroundColor: "#f9fafb", fontFamily: "Helvetica, Arial, sans-serif", margin: 0 }}>
        <Container
          style={{
            maxWidth: "600px",
            margin: "0 auto",
            backgroundColor: "#ffffff",
            border: "1px solid #e5e7eb",
            borderRadius: "8px",
            padding: "32px",
          }}
        >
          <Section style={{ marginBottom: "24px" }}>
            {logoUrl && (
              <Img src={logoUrl} width="40" height="40" alt="" style={{ borderRadius: "6px", marginBottom: "8px" }} />
            )}
            <Text style={{ ...text, fontWeight: 600, margin: 0 }}>{companyName}</Text>
          </Section>

          <Section>
            <ReactMarkdown components={COMPONENTS}>{bodyMd}</ReactMarkdown>
          </Section>

          <Section style={{ borderTop: "1px solid #e5e7eb", marginTop: "24px", paddingTop: "16px" }}>
            <Text style={muted}>
              {`Sent by ${companyName}.` +
                (companyEmail ? ` Replies go to ${companyEmail}.` : "")}
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}
