"use client";

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
      <img
        src={
          type === "long" ? "/logos/long-light.png" : "/logos/short-light.png"
        }
        alt="GetHired logo"
        className="w-full h-full object-contain dark:hidden"
        loading="eager"
        decoding="async"
      />

      <img
        src={type === "long" ? "/logos/long-dark.png" : "/logos/short-dark.png"}
        alt="GetHired logo"
        className="w-full h-full object-contain hidden dark:block"
        loading="eager"
        decoding="async"
      />
    </div>
  );
}
