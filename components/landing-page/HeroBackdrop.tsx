import { GridPattern } from "@/components/magicui/grid-pattern";

/**
 * The landing heroes' look, shared so every page matches the MCP server page:
 * a dashed grid that fades out from the top, behind the hero (whose section must
 * be `relative isolate`), and a light shadow under the hero's product preview.
 */
export const HERO_ARTIFACT_SHADOW =
  "shadow-[0_24px_64px_-32px_rgb(0_0_0/0.22)] dark:shadow-[0_24px_64px_-32px_rgb(0_0_0/0.8)]";

export function HeroBackdrop() {
  return (
    <GridPattern
      width={36}
      height={36}
      strokeDasharray="4 2"
      className="-z-10 [mask-image:radial-gradient(ellipse_at_top,white,transparent_60%)]"
    />
  );
}
