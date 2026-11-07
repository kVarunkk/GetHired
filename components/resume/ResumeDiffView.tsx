"use client";

import { Fragment } from "react";
import { TEMPLATE_CLASSES } from "@/components/resume/ResumePreview";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import {
  compactDiffRows,
  type DiffBullet,
  type DiffItem,
  type DiffMark,
  type DiffText,
  type ResumeDiff,
} from "@/helpers/resumes/resume-diff";
import { cn } from "@/utils/utils";

const ADDED = "text-success underline decoration-success/50 underline-offset-2";
const REMOVED = "text-muted-foreground line-through";

const unchangedCount = (count: number, one: string, many: string) =>
  `${count} unchanged ${count === 1 ? one : many}`;

/** Text only, so whatever a resume holds stays inert, links included (RI-SEC-003). */
function Marked({ part }: { part: Pick<DiffText, "text" | "segments"> & { mark: DiffMark } }) {
  if (part.segments) {
    return (
      <>
        {part.segments.map((segment, index) => {
          if (segment.kind === "added") {
            return (
              <ins key={index} className={ADDED}>
                {segment.text}
              </ins>
            );
          }
          if (segment.kind === "removed") {
            return (
              <del key={index} className={REMOVED}>
                {segment.text}
              </del>
            );
          }
          return <Fragment key={index}>{segment.text}</Fragment>;
        })}
      </>
    );
  }
  if (part.mark === "added") {
    return (
      <ins className={ADDED}>
        <span aria-hidden>+ </span>
        <span className="sr-only">Added: </span>
        {part.text}
      </ins>
    );
  }
  if (part.mark === "removed") {
    return (
      <del className={REMOVED}>
        <span className="sr-only">Removed: </span>
        {part.text}
      </del>
    );
  }
  return <>{part.text}</>;
}

const MovedTag = () => <span className="ml-1.5 text-xs font-normal text-muted-foreground">(moved)</span>;

function Bullets({ bullets, plain }: { bullets: DiffBullet[]; plain: boolean }) {
  const lines = bullets.map((bullet) => (
    <Fragment key={bullet.id}>
      <Marked part={bullet} />
      {bullet.mark === "moved" && <MovedTag />}
    </Fragment>
  ));

  if (plain) return lines.map((line) => <p key={line.key}>{line}</p>);
  if (bullets.length === 0) return null;
  return (
    <ul className="mt-0.5 list-disc pl-4">
      {lines.map((line) => (
        <li key={line.key}>{line}</li>
      ))}
    </ul>
  );
}

function ItemHeading({ item }: { item: DiffItem }) {
  return (
    <>
      {item.title && (
        <p className="font-semibold">
          <Marked part={item.title} />
          {item.mark === "moved" && <MovedTag />}
        </p>
      )}
      {item.meta && (
        <p className="text-muted-foreground">
          <Marked part={item.meta} />
        </p>
      )}
      {item.link && (
        <p className="text-muted-foreground">
          <Marked part={item.link} />
        </p>
      )}
    </>
  );
}

/** Only the bullets that changed, with each unchanged run as one line. */
function CompactBullets({ bullets, plain }: { bullets: DiffBullet[]; plain: boolean }) {
  const groups: (DiffBullet[] | number)[] = [];
  for (const bullet of bullets) {
    const last = groups[groups.length - 1];
    if (bullet.mark === "unchanged") {
      if (typeof last === "number") groups[groups.length - 1] = last + 1;
      else groups.push(1);
    } else if (Array.isArray(last)) {
      last.push(bullet);
    } else {
      groups.push([bullet]);
    }
  }

  return groups.map((group, index) =>
    typeof group === "number" ? (
      <p key={index} className="text-muted-foreground">
        {unchangedCount(group, "bullet", "bullets")}
      </p>
    ) : (
      <Bullets key={index} bullets={group} plain={plain} />
    ),
  );
}

function ContactLines({ diff }: { diff: ResumeDiff }) {
  return (
    <>
      {diff.name && (
        <p className="font-semibold">
          <Marked part={diff.name} />
        </p>
      )}
      {diff.headline && (
        <p>
          <Marked part={diff.headline} />
        </p>
      )}
      {diff.contact && (
        <p className="text-muted-foreground">
          <Marked part={diff.contact} />
        </p>
      )}
    </>
  );
}

function CompactDiff({ diff }: { diff: ResumeDiff }) {
  const contactChanged = [diff.name, diff.headline, diff.contact].some((part) => part && part.mark !== "unchanged");

  return (
    <div className="flex flex-col gap-1.5 break-words">
      {contactChanged && (
        <div>
          <ContactLines diff={diff} />
        </div>
      )}
      {compactDiffRows(diff).map((row, index) => {
        if (row.type === "unchanged") {
          return (
            <p key={`unchanged-${index}`} className="text-muted-foreground">
              {unchangedCount(row.count, "entry", "entries")}
            </p>
          );
        }
        if (row.type === "section") {
          return (
            <p key={row.section.id} className="border-b pb-0.5 font-semibold">
              <Marked part={row.section.title} />
              {row.section.mark === "moved" && <MovedTag />}
            </p>
          );
        }
        return (
          <div key={row.item.id}>
            <ItemHeading item={row.item} />
            <CompactBullets bullets={row.item.bullets} plain={row.plain} />
          </div>
        );
      })}
    </div>
  );
}

function FullDiff({ diff }: { diff: ResumeDiff }) {
  const classes = TEMPLATE_CLASSES[diff.template];

  return (
    <article
      aria-label="Resume with changes"
      className={cn("w-full break-words rounded-lg border bg-card text-card-foreground", classes.page)}
    >
      <ContactLines diff={diff} />
      {diff.sections.map((section) => (
        <section key={section.id} className={classes.gap}>
          <h3 className={cn("mb-1.5 border-b pb-0.5 font-semibold", classes.heading)}>
            <Marked part={section.title} />
            {section.mark === "moved" && <MovedTag />}
          </h3>
          {section.items.map((item) => (
            <div key={item.id} className={classes.item}>
              <ItemHeading item={item} />
              <Bullets bullets={item.bullets} plain={section.plain} />
            </div>
          ))}
        </section>
      ))}
    </article>
  );
}

/**
 * A resume edit where it lands (RI-REQ-004): the changed parts in the chat, and
 * the whole resume in a side sheet. Added and removed text is marked by more
 * than colour.
 */
export default function ResumeDiffView({ diff, className }: { diff: ResumeDiff; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-2 text-xs", className)}>
      <CompactDiff diff={diff} />
      <Sheet>
        <SheetTrigger asChild>
          <Button type="button" variant="outline" size="sm" className="self-start">
            Full view
          </Button>
        </SheetTrigger>
        <SheetContent className="flex w-full flex-col gap-4 overflow-y-auto sm:max-w-2xl">
          <SheetTitle>Resume with changes</SheetTitle>
          <FullDiff diff={diff} />
        </SheetContent>
      </Sheet>
    </div>
  );
}
