import { Fragment } from "react";
import { linkify, paragraphs } from "@/helpers/outreach/linkify";

/**
 * A company-written message, as plain text (OR-SEC-002): paragraphs and line
 * breaks kept, only `https://` URLs linked (opening in a new tab, no referrer).
 */
export default function PlainMessage({ text }: { text: string }) {
  return (
    <div className="flex flex-col gap-3 text-[15px] leading-7">
      {paragraphs(text).map((lines, i) => (
        <p key={i} className="whitespace-pre-wrap break-words">
          {lines.map((line, j) => (
            <Fragment key={j}>
              {j > 0 && <br />}
              {linkify(line).map((seg, k) =>
                seg.type === "link" ? (
                  <a
                    key={k}
                    href={seg.value}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="underline underline-offset-2 hover:text-brand"
                  >
                    {seg.value}
                  </a>
                ) : (
                  <Fragment key={k}>{seg.value}</Fragment>
                ),
              )}
            </Fragment>
          ))}
        </p>
      ))}
    </div>
  );
}
