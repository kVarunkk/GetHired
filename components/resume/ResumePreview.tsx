import type { ResumeDocument, ResumeDocumentLink } from "@/helpers/resume/render/document";
import { cn } from "@/utils/utils";

const TEMPLATE_CLASSES = {
  classic: { page: "p-8 text-sm", name: "text-2xl", heading: "text-base", gap: "mt-5", item: "mb-3" },
  compact: { page: "p-6 text-xs", name: "text-xl", heading: "text-sm", gap: "mt-3", item: "mb-2" },
} as const;

function DocumentLink({ part }: { part: ResumeDocumentLink }) {
  if (!part.href) return <span>{part.text}</span>;
  return (
    <a href={part.href} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:underline">
      {part.text}
    </a>
  );
}

/**
 * A resume as it will read, from the same document as the PDF and Word file
 * (RE-REQ-051). Text is rendered as text, so whatever a resume holds stays
 * inert. `activeBulletId` marks the bullet being edited or reviewed.
 */
export default function ResumePreview({
  document,
  activeBulletId,
  className,
}: {
  document: ResumeDocument;
  activeBulletId?: string | null;
  className?: string;
}) {
  const classes = TEMPLATE_CLASSES[document.template];
  const isEmpty = !document.name && !document.headline && document.contact.length === 0 && document.sections.length === 0;

  return (
    <article
      aria-label="Resume preview"
      className={cn("w-full rounded-lg border bg-card text-card-foreground", classes.page, className)}
    >
      {isEmpty && <p className="text-muted-foreground">Nothing here yet. Add details to see your resume.</p>}
      {document.name && <h2 className={cn("font-semibold", classes.name)}>{document.name}</h2>}
      {document.headline && <p className="mt-0.5">{document.headline}</p>}
      {document.contact.length > 0 && (
        <p className="mt-1 text-muted-foreground">
          {document.contact.map((part, index) => (
            <span key={part.text}>
              {index > 0 && " · "}
              <DocumentLink part={part} />
            </span>
          ))}
        </p>
      )}
      {document.sections.map((section) => (
        <section key={section.id} className={classes.gap}>
          <h3 className={cn("mb-1.5 border-b pb-0.5 font-semibold", classes.heading)}>{section.title}</h3>
          {section.items.map((item) => (
            <div key={item.id} className={classes.item}>
              {item.title && <p className="font-semibold">{item.title}</p>}
              {item.meta && <p className="text-muted-foreground">{item.meta}</p>}
              {item.link && (
                <p className="text-muted-foreground">
                  <DocumentLink part={item.link} />
                </p>
              )}
              {section.plain ? (
                item.bullets.map((bullet) => (
                  <p
                    key={bullet.id}
                    id={`bullet-${bullet.id}`}
                    data-active={bullet.id === activeBulletId || undefined}
                    className="rounded-sm data-[active]:bg-accent"
                  >
                    {bullet.text}
                  </p>
                ))
              ) : item.bullets.length > 0 ? (
                <ul className="mt-0.5 list-disc pl-4">
                  {item.bullets.map((bullet) => (
                    <li
                      key={bullet.id}
                      id={`bullet-${bullet.id}`}
                      data-active={bullet.id === activeBulletId || undefined}
                      className="rounded-sm data-[active]:bg-accent"
                    >
                      {bullet.text}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ))}
        </section>
      ))}
    </article>
  );
}
