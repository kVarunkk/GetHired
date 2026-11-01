import { ArrowRight } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { Button } from "../ui/button";
import { cn, HeroMaskStyle } from "@/utils/utils";
import { HERO_ARTIFACT_SHADOW, HeroBackdrop } from "./HeroBackdrop";

/** Same side padding as the navbar, so the hero lines up with it. */
const GUTTER = "px-4 lg:px-20 xl:px-40 2xl:px-80";

type HeroProps = {
  heading: React.ReactNode;
  subheading: React.ReactNode;
  ctaText: string;
  ctaLink: string;
  ctaText2?: string;
  ctaLink2?: string;
  /** A small pill above the heading (see `HeroEyebrow`). */
  eyebrow?: React.ReactNode;
  /** Shown under the buttons, e.g. a row of supported clients. */
  below?: React.ReactNode;
  imgLight?: string;
  imgDark?: string;
  imgAlt?: string;
  /** Shown instead of the screenshots, e.g. a live product demo. */
  preview?: React.ReactNode;
  /** The preview draws its own frame and shadow. */
  previewFramed?: boolean;
};

/** The pill above a hero heading. Pass `href` to make it a link. */
export function HeroEyebrow({
  icon,
  label,
  detail,
  href,
}: {
  icon?: React.ReactNode;
  label: string;
  detail?: string;
  href?: string;
}) {
  const content = (
    <>
      <span className="flex shrink-0 items-center gap-1.5 rounded-full border bg-muted/40 px-2 py-0.5">
        {icon}
        {label}
      </span>
      {detail && <span className="hidden truncate text-muted-foreground sm:inline">{detail}</span>}
      {href && (
        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      )}
    </>
  );
  const className = cn(
    "group inline-flex max-w-full items-center gap-2 rounded-full border bg-background py-1 pl-1 text-xs font-medium",
    detail || href ? "pr-3" : "pr-1",
    href && "transition-colors hover:bg-muted/60",
  );
  return href ? (
    <Link href={href} className={className}>
      {content}
    </Link>
  ) : (
    <span className={className}>{content}</span>
  );
}

/** The one hero for every marketing page (modelled on /mcp-server). */
export default function Hero({
  heading,
  subheading,
  ctaText,
  ctaLink,
  ctaText2,
  ctaLink2,
  eyebrow,
  below,
  imgLight,
  imgDark,
  imgAlt = "Snapshot of GetHired",
  preview,
  previewFramed = false,
}: HeroProps) {
  return (
    <section className="relative isolate">
      <HeroBackdrop />
      <div className={cn("flex flex-col items-center gap-6 py-3 text-center", GUTTER)}>
        {eyebrow}

        <h1 className="max-w-4xl text-4xl font-semibold leading-[1.1] tracking-tight sm:text-6xl sm:leading-[1.05] lg:text-7xl">
          {heading}
        </h1>
        <p className="mx-auto max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-xl">{subheading}</p>

        <div className="flex w-full flex-col items-stretch justify-center gap-3 sm:w-fit sm:flex-row sm:flex-wrap sm:items-center">
          <Button asChild variant="brand" size="lg" className="flex-auto">
            <Link href={ctaLink}>
              {ctaText}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
          {ctaLink2 && ctaText2 && (
            <Button asChild variant="outline" size="lg" className="flex-auto bg-background">
              <Link href={ctaLink2}>{ctaText2}</Link>
            </Button>
          )}
        </div>

        {below}

        {preview ? (
          <div className={cn("mt-6 w-full min-w-0 sm:mt-8", !previewFramed && cn("rounded-xl", HERO_ARTIFACT_SHADOW))}>
            {preview}
          </div>
        ) : (
          imgLight &&
          imgDark && (
            <div className="mt-6 w-full min-w-0 sm:mt-8">
              <Image
                className={cn("w-full rounded-xl border border-border dark:hidden", HERO_ARTIFACT_SHADOW)}
                src={imgLight}
                style={HeroMaskStyle}
                height={1200}
                width={1200}
                alt={imgAlt}
                priority
              />
              <Image
                className={cn("hidden w-full rounded-xl border border-border dark:block", HERO_ARTIFACT_SHADOW)}
                src={imgDark}
                style={HeroMaskStyle}
                height={1200}
                width={1200}
                alt={imgAlt}
                priority
              />
            </div>
          )
        )}
      </div>
    </section>
  );
}
