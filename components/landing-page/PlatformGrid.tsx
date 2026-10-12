import Image from "next/image";
import Link from "next/link";
import { LightningBoltIcon } from "@radix-ui/react-icons";
import { platforms } from "@/utils/utils";

// Static logo grid: hover/focus effects are CSS transitions only, so nothing
// animates (or re-renders) while the user is just scrolling past.
const tileClass =
  "flex w-full flex-col items-center gap-1.5 rounded-xl p-1 outline-none sm:p-2 transition-[opacity,transform,background-color] duration-200 ease-out group-hover/logos:opacity-40 hover:!opacity-100 hover:-translate-y-1 hover:bg-muted focus-visible:!opacity-100 focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring";

export function PlatformGrid() {
  return (
    <div className="flex h-[130px] w-full items-center justify-center px-3 sm:h-[160px] lg:h-[350px]">
      <ul className="group/logos grid w-full max-w-sm grid-cols-6 gap-1.5 sm:w-auto sm:max-w-none sm:gap-3 lg:grid-cols-4 lg:gap-4">
        {platforms.map((platform) => (
          <li key={platform.id}>
            <Link
              href={platform.href}
              title={`${platform.name} jobs`}
              className={tileClass}
            >
              <Image
                src={platform.src}
                alt={`${platform.name} logo`}
                width={48}
                height={48}
                className="aspect-square h-auto w-full rounded-lg object-contain shadow-sm sm:size-12 sm:rounded-xl"
              />
              <span className="hidden text-xs font-medium text-muted-foreground lg:block">
                {platform.name}
              </span>
            </Link>
          </li>
        ))}
        <li>
          <Link href="/jobs" title="All jobs" className={tileClass}>
            <span className="flex aspect-square w-full items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm sm:size-12 sm:rounded-xl">
              <LightningBoltIcon className="size-5" />
            </span>
            <span className="hidden text-xs font-medium text-muted-foreground lg:block">
              All jobs
            </span>
          </Link>
        </li>
      </ul>
    </div>
  );
}
