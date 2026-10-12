"use client";

import { cn } from "@/utils/utils";

export default function DigitalTwinMirror({
  content,
  activeHighlightId,
}: {
  content?: {
    sections?: {
      type?: string;
      items?: {
        bullets?: {
          id?: string;
          text?: string;
          lineIndices?: string[];
        }[];
        heading?: string;
        subheading?: string;
      }[];
    }[];
  };
  activeHighlightId: string | null;
}) {
  if (!content?.sections) return null;

  return (
    <div className="w-full max-w-3xl mx-auto bg-card md:min-h-[1056px] p-6 md:p-12 text-foreground font-sans border rounded-xl">
      <div className="space-y-8">
        {content.sections.map((section, sIdx: number) => (
          <div key={sIdx} className="space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground border-b pb-1">
              {section.type}
            </h3>

            {section?.items?.map((item, iIdx: number) => (
              <div key={iIdx} className="space-y-2">
                {item.heading && (
                  <p className="text-sm font-semibold">{item.heading}</p>
                )}
                {item.subheading && (
                  <p className="text-sm font-medium">{item.subheading}</p>
                )}
                <ul className="space-y-1.5">
                  {item?.bullets?.map((bullet) => (
                    <li
                      key={bullet.id}
                      id={`bullet-${bullet.id}`}
                      className={cn(
                        "text-xs leading-relaxed transition-all duration-300 rounded px-1 -mx-1",
                        activeHighlightId === bullet.id
                          ? "bg-brandSoft text-brandSoft-foreground ring-1 ring-brand/40"
                          : "text-muted-foreground",
                      )}
                    >
                      • {bullet.text}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
