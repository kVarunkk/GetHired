"use client";

import { cn } from "@/lib/utils";

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
    <div className="w-full max-w-3xl mx-auto bg-white dark:bg-zinc-900 shadow-2xl md:min-h-[1056px] p-6 md:p-12 text-zinc-800 dark:text-zinc-200 font-sans border border-zinc-200 dark:border-zinc-800 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="space-y-8">
        {content.sections.map((section, sIdx: number) => (
          <div key={sIdx} className="space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-brand border-b pb-1 border-indigo-100 dark:border-indigo-900/50">
              {section.type}
            </h3>

            {section?.items?.map((item, iIdx: number) => (
              <div key={iIdx} className="space-y-2">
                {item.heading && (
                  <p className="text-sm font-bold">{item.heading}</p>
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
                          ? "bg-brandSoft text-brand dark:text-primary font-medium ring-1 ring-indigo-500/50 scale-[1.02] shadow-sm"
                          : "text-muted-foreground"
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
