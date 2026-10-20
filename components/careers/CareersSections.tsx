import ReactMarkdown from "react-markdown";
import type { CareersSection } from "@/helpers/careers/page-schema";

/**
 * Markdown without raw HTML or images; links open safely (CP-SEC-002). Only
 * in-text formatting, lists and links survive.
 */
export function SafeMarkdown({ children }: { children: string }) {
  return (
    <div className="flex max-w-3xl flex-col gap-3 text-[15px] leading-7 [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5">
      <ReactMarkdown
        skipHtml
        components={{
          img: () => null,
          a: ({ href, children: label }) =>
            href && /^https?:\/\//.test(href) ? (
              <a href={href} target="_blank" rel="nofollow noopener noreferrer ugc" className="text-[var(--careers-accent)] underline underline-offset-4">
                {label}
              </a>
            ) : (
              <span>{label}</span>
            ),
          h1: ({ children: text }) => <h3 className="text-lg font-semibold tracking-tight">{text}</h3>,
          h2: ({ children: text }) => <h3 className="text-lg font-semibold tracking-tight">{text}</h3>,
          h3: ({ children: text }) => <h4 className="font-semibold">{text}</h4>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

/** CP-REQ-004: About, perks and custom sections, in order; hidden ones are skipped. */
export default function CareersSections({
  sections,
  about,
}: {
  sections: CareersSection[];
  /** The company profile's description, shown by the About section. */
  about: string | null;
}) {
  const visible = sections.filter((s) => !s.hidden);
  if (visible.length === 0) return null;
  return (
    <div className="flex flex-col gap-10">
      {visible.map((section) => {
        if (section.kind === "about") {
          if (!about) return null;
          return (
            <section key={section.id} aria-labelledby={`s-${section.id}`} className="flex flex-col gap-3">
              <h2 id={`s-${section.id}`} className="text-lg font-semibold tracking-tight">
                About us
              </h2>
              <SafeMarkdown>{about}</SafeMarkdown>
            </section>
          );
        }
        if (section.kind === "perks") {
          if (section.items.length === 0) return null;
          return (
            <section key={section.id} aria-labelledby={`s-${section.id}`} className="flex flex-col gap-3">
              <h2 id={`s-${section.id}`} className="text-lg font-semibold tracking-tight">
                {section.title}
              </h2>
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {section.items.map((item, i) => (
                  <li key={i} className="rounded-xl border p-4">
                    <p className="font-medium">{item.title}</p>
                    {item.text && <p className="mt-1 text-sm text-muted-foreground">{item.text}</p>}
                  </li>
                ))}
              </ul>
            </section>
          );
        }
        return (
          <section key={section.id} aria-labelledby={`s-${section.id}`} className="flex flex-col gap-3">
            <h2 id={`s-${section.id}`} className="text-lg font-semibold tracking-tight">
              {section.title}
            </h2>
            {section.body && <SafeMarkdown>{section.body}</SafeMarkdown>}
          </section>
        );
      })}
    </div>
  );
}
