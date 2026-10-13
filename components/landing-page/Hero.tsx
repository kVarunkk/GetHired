"use client";

import { Button } from "../ui/button";
import Link from "next/link";
import Image from "next/image";
import { HeroMaskStyle } from "@/utils/utils";

type HeroProps = {
  heading: string;
  subheading: string;
  ctaText: string;
  ctaLink: string;
  ctaText2?: string;
  ctaLink2?: string;
  imgLight?: string;
  imgDark?: string;
  /** Shown instead of the screenshots, e.g. a live product demo. */
  preview?: React.ReactNode;
};

export default function Hero({
  heading,
  subheading,
  ctaText,
  ctaLink,
  ctaText2,
  ctaLink2,
  imgLight,
  imgDark,
  preview,
}: HeroProps) {
  return (
    <div className="flex flex-col gap-5 w-full items-center text-center px-4 py-3 lg:px-20 xl:px-40 2xl:px-80">
      <h1 className="text-5xl sm:text-7xl font-semibold tracking-tight leading-[1.1]">
        {heading}
      </h1>
      <p className="text-muted-foreground text-lg sm:text-xl max-w-2xl mx-auto leading-relaxed">
        {subheading}
      </p>
      {/* fit-content width: on one line the buttons keep their size; once they
          wrap, the row is full width and each button grows to fill it. */}
      <div className="flex w-fit max-w-full flex-wrap items-center justify-center gap-3 sm:gap-5">
        <Button asChild variant="brand" className="flex-auto">
          <Link href={ctaLink}>{ctaText}</Link>
        </Button>

        {ctaLink2 && (
          <Button asChild variant="outline" className="flex-auto">
            <Link href={ctaLink2}>{ctaText2}</Link>
          </Button>
        )}
      </div>

      {preview ? (
        <div className="mt-8 w-full max-w-5xl">{preview}</div>
      ) : (
        imgLight &&
        imgDark && (
          <div>
            <Image
              className="rounded-xl border border-border drop-shadow-xl mt-8 dark:hidden"
              src={imgLight}
              style={HeroMaskStyle}
              height={1200}
              width={1200}
              alt="Snapshot of the GetHired Job Board"
              priority
            />
            <Image
              className="rounded-xl border border-border drop-shadow-xl mt-8 hidden dark:block"
              src={imgDark}
              style={HeroMaskStyle}
              height={1200}
              width={1200}
              alt="Snapshot of the GetHired Job Board"
              priority
            />
          </div>
        )
      )}
    </div>
  );
}
