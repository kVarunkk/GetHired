import ReactMarkdown from "react-markdown";
import { cn } from "@/utils/utils";

/** Descriptions are markdown: no raw HTML or images, links open safely. */
export default function JobMarkdown({ children, className }: { children: string; className?: string }) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 text-sm leading-6 [overflow-wrap:anywhere] [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5",
        className,
      )}
    >
      <ReactMarkdown
        skipHtml
        components={{
          img: () => null,
          a: ({ href, children: label }) =>
            href && /^https?:\/\//.test(href) ? (
              <a href={href} target="_blank" rel="nofollow noopener noreferrer ugc" className="underline underline-offset-4">
                {label}
              </a>
            ) : (
              <span>{label}</span>
            ),
          h1: ({ children: t }) => <h3 className="font-semibold">{t}</h3>,
          h2: ({ children: t }) => <h3 className="font-semibold">{t}</h3>,
          h3: ({ children: t }) => <h4 className="font-semibold">{t}</h4>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
