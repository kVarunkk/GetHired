"use client";

import {
  BRAND_LONG_DARK,
  BRAND_LONG_LIGHT,
  BRAND_SHORT_DARK,
  BRAND_SHORT_LIGHT,
} from "@/utils/utils";
import Image from "next/image";

interface BrandProps {
  type: "long" | "short";
}

export default function Brand({ type }: BrandProps) {
  const dimensionsClass =
    type === "long"
      ? "w-[100px] sm:w-[150px] h-[30px] sm:h-[40px] md:h-[50px]"
      : "w-[32px] sm:w-[40px] md:w-[50px] h-[32px] sm:h-[40px] md:h-[50px]";

  return (
    <div className={`relative ${dimensionsClass}`}>
      {/* Light Mode Logo */}
      <div className="dark:hidden w-full h-full relative">
        <Image
          src={type === "long" ? BRAND_LONG_LIGHT : BRAND_SHORT_LIGHT}
          alt="GetHired logo"
          fill
          sizes="(max-width: 640px) 100px, (max-width: 768px) 150px, 150px"
          className="object-contain"
          priority // Replaces loading="eager" for LCP priority elements
        />
      </div>

      {/* Dark Mode Logo */}
      <div className="hidden dark:block w-full h-full relative">
        <Image
          src={type === "long" ? BRAND_LONG_DARK : BRAND_SHORT_DARK}
          alt="GetHired logo"
          fill
          sizes="(max-width: 640px) 100px, (max-width: 768px) 150px, 150px"
          className="object-contain"
          priority
        />
      </div>
    </div>
  );
}
